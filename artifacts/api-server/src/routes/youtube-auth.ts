import { Router, type IRouter } from "express";
import { google } from "googleapis";
import { eq, and } from "drizzle-orm";
import { db, apiTokensTable, channelsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { getConfig } from "../lib/app-config";

const router: IRouter = Router();

async function getOAuthClient() {
  const clientId = await getConfig("YOUTUBE_CLIENT_ID");
  const clientSecret = await getConfig("YOUTUBE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error(
      "YouTube credentials are not configured. Add YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in Settings.",
    );
  }

  const domains = process.env.REPLIT_DOMAINS?.split(",") ?? [];
  const primaryDomain = domains[0];
  const redirectBase =
    process.env.APP_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    (primaryDomain ? `https://${primaryDomain}` : "http://localhost:3000");

  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    `${redirectBase}/api/auth/youtube/callback`,
  );
}

// ── Step 1: Start OAuth flow ─────────────────────────────────────────────────
router.get("/auth/youtube", async (req, res): Promise<void> => {
  try {
    const oauth2Client = await getOAuthClient();
    const scopes = [
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube.readonly",
    ];
    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: scopes,
      prompt: "consent",
    });
    res.redirect(url);
  } catch (err) {
    logger.error({ err }, "YouTube OAuth init failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "OAuth init failed" });
  }
});

// ── Step 2: OAuth callback — exchange code, store new channel ───────────────
router.get("/auth/youtube/callback", async (req, res): Promise<void> => {
  const code = req.query.code as string;
  if (!code) {
    res.status(400).send("Missing OAuth code");
    return;
  }

  try {
    const oauth2Client = await getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const yt = google.youtube({ version: "v3", auth: oauth2Client });
    const channelRes = await yt.channels.list({
      part: ["snippet", "statistics"],
      mine: true,
    });

    const channel = channelRes.data.items?.[0];
    const channelName = channel?.snippet?.title ?? "My YouTube Channel";
    const channelId = channel?.id ?? "";
    const thumbnailUrl = channel?.snippet?.thumbnails?.default?.url ?? null;
    const subscriberCount = channel?.statistics?.subscriberCount
      ? parseInt(channel.statistics.subscriberCount, 10)
      : null;

    // Check if this channel is already connected (match by channelId)
    const existingChannel = channelId
      ? await db
          .select()
          .from(channelsTable)
          .where(and(eq(channelsTable.platform, "youtube"), eq(channelsTable.channelId, channelId)))
          .limit(1)
      : [];

    let tokenId: number;

    if (existingChannel.length > 0) {
      // Update the existing token for this channel
      const [updatedToken] = await db
        .update(apiTokensTable)
        .set({
          accessToken: tokens.access_token!,
          refreshToken: tokens.refresh_token ?? undefined,
          label: channelName,
          isActive: true,
        })
        .where(eq(apiTokensTable.id, existingChannel[0].tokenId!))
        .returning();
      tokenId = updatedToken.id;

      await db
        .update(channelsTable)
        .set({ channelName, thumbnailUrl, subscriberCount, isActive: true })
        .where(eq(channelsTable.id, existingChannel[0].id));
    } else {
      // New channel — insert fresh token + channel row
      const [newToken] = await db
        .insert(apiTokensTable)
        .values({
          platform: "youtube",
          accessToken: tokens.access_token!,
          refreshToken: tokens.refresh_token ?? null,
          label: channelName,
          isActive: true,
        })
        .returning();
      tokenId = newToken.id;

      // First channel added becomes the default
      const existingCount = await db
        .select()
        .from(channelsTable)
        .where(and(eq(channelsTable.platform, "youtube"), eq(channelsTable.isActive, true)));
      const isFirst = existingCount.length === 0;

      await db.insert(channelsTable).values({
        platform: "youtube",
        channelId,
        channelName,
        thumbnailUrl,
        subscriberCount,
        tokenId,
        isDefault: isFirst,
        isActive: true,
      });
    }

    logger.info({ channelName, channelId }, "YouTube channel connected");
    res.redirect("/settings?oauth=youtube_connected");
  } catch (err) {
    logger.error({ err }, "YouTube OAuth callback failed");
    res.redirect("/settings?oauth=youtube_error");
  }
});

// ── List all connected YouTube channels ──────────────────────────────────────
router.get("/auth/youtube/channels", async (_req, res): Promise<void> => {
  const channels = await db
    .select()
    .from(channelsTable)
    .where(and(eq(channelsTable.platform, "youtube"), eq(channelsTable.isActive, true)));
  res.json(channels);
});

// ── Set a channel as default ─────────────────────────────────────────────────
router.post("/auth/youtube/channels/:id/default", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  await db
    .update(channelsTable)
    .set({ isDefault: false })
    .where(eq(channelsTable.platform, "youtube"));

  await db
    .update(channelsTable)
    .set({ isDefault: true })
    .where(eq(channelsTable.id, id));

  res.json({ ok: true });
});

// ── Disconnect a specific channel ────────────────────────────────────────────
router.delete("/auth/youtube/channels/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [ch] = await db
    .select()
    .from(channelsTable)
    .where(eq(channelsTable.id, id))
    .limit(1);

  if (!ch) { res.status(404).json({ error: "Channel not found" }); return; }

  await db.update(channelsTable).set({ isActive: false }).where(eq(channelsTable.id, id));
  if (ch.tokenId) {
    await db.update(apiTokensTable).set({ isActive: false }).where(eq(apiTokensTable.id, ch.tokenId));
  }

  // If this was the default, promote another channel
  if (ch.isDefault) {
    const [next] = await db
      .select()
      .from(channelsTable)
      .where(and(eq(channelsTable.platform, "youtube"), eq(channelsTable.isActive, true)))
      .limit(1);
    if (next) {
      await db.update(channelsTable).set({ isDefault: true }).where(eq(channelsTable.id, next.id));
    }
  }

  res.sendStatus(204);
});

// ── Status check (backward-compat — returns the default channel) ─────────────
router.get("/auth/youtube/status", async (_req, res): Promise<void> => {
  const channels = await db
    .select()
    .from(channelsTable)
    .where(and(eq(channelsTable.platform, "youtube"), eq(channelsTable.isActive, true)));

  const def = channels.find((c) => c.isDefault) ?? channels[0] ?? null;

  const [token] = def?.tokenId
    ? await db.select().from(apiTokensTable).where(eq(apiTokensTable.id, def.tokenId)).limit(1)
    : [];

  const clientId = await getConfig("YOUTUBE_CLIENT_ID");
  const clientSecret = await getConfig("YOUTUBE_CLIENT_SECRET");

  res.json({
    connected: channels.length > 0,
    channelCount: channels.length,
    credentialsConfigured: !!(clientId && clientSecret),
    channelName: def?.channelName ?? null,
    channelId: def?.channelId ?? null,
    subscriberCount: def?.subscriberCount ?? null,
    thumbnailUrl: def?.thumbnailUrl ?? null,
  });
});

// ── Legacy disconnect all ────────────────────────────────────────────────────
router.delete("/auth/youtube", async (_req, res): Promise<void> => {
  await db.update(apiTokensTable).set({ isActive: false }).where(eq(apiTokensTable.platform, "youtube"));
  await db.update(channelsTable).set({ isActive: false }).where(eq(channelsTable.platform, "youtube"));
  res.sendStatus(204);
});

export default router;
