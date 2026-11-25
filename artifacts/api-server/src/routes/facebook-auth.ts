import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, apiTokensTable, channelsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { getConfig } from "../lib/app-config";

const router: IRouter = Router();
const FB_API = "https://graph.facebook.com/v19.0";

function getRedirectUri(origin: string) {
  return `${origin}/api/auth/facebook/callback`;
}

function getRequestOrigin(req?: {
  protocol?: string;
  get: (name: string) => string | undefined;
}): string | null {
  if (!req) return null;
  const host = req.get("x-forwarded-host") || req.get("host");
  if (!host) return null;
  const proto = (req.get("x-forwarded-proto") || req.protocol || "https")
    .split(",")[0]
    .trim();
  return `${proto}://${host}`;
}

function getOrigin(req?: {
  protocol?: string;
  get: (name: string) => string | undefined;
}) {
  const domains = process.env.REPLIT_DOMAINS?.split(",") ?? [];
  const primary = domains[0];
  const raw =
    process.env.APP_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    getRequestOrigin(req) ||
    (primary ? `https://${primary}` : "http://localhost:3000");
  return raw.replace(/\/+$/, "");
}

// ── Step 1: Start Facebook OAuth ─────────────────────────────────────────────
router.get("/auth/facebook", async (req, res): Promise<void> => {
  try {
    const appId = (await getConfig("FACEBOOK_APP_ID"))?.trim();
    if (!appId) {
      res.status(400).json({ error: "FACEBOOK_APP_ID is not configured — add it in Settings first." });
      return;
    }
    const redirectUri = encodeURIComponent(getRedirectUri(getOrigin(req)));
    const scopes = "pages_show_list,pages_manage_posts,pages_read_engagement,business_management";
    const url = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${appId}&redirect_uri=${redirectUri}&scope=${scopes}&response_type=code&auth_type=rerequest`;
    res.redirect(url);
  } catch (err) {
    logger.error({ err }, "Facebook OAuth init failed");
    res.redirect("/settings?oauth=facebook_error");
  }
});

// ── Step 2: OAuth callback ────────────────────────────────────────────────────
router.get("/auth/facebook/callback", async (req, res): Promise<void> => {
  const code = req.query.code as string;
  const error = req.query.error as string;

  if (error || !code) {
    logger.warn({ error, code: !!code }, "Facebook OAuth denied or missing code");
    res.redirect("/settings?oauth=facebook_error");
    return;
  }

  try {
    const appId = (await getConfig("FACEBOOK_APP_ID"))?.trim();
    const appSecret = (await getConfig("FACEBOOK_APP_SECRET"))?.trim();
    if (!appId || !appSecret) throw new Error("Facebook App ID and Secret not configured");

    const origin = getOrigin(req);
    const redirectUri = encodeURIComponent(getRedirectUri(origin));

    // Exchange code for short-lived user token
    const tokenRes = await fetch(
      `${FB_API}/oauth/access_token?client_id=${appId}&redirect_uri=${redirectUri}&client_secret=${appSecret}&code=${code}`
    );
    if (!tokenRes.ok) throw new Error(`Token exchange failed: ${await tokenRes.text()}`);
    const tokenData = (await tokenRes.json()) as { access_token: string };
    const shortToken = tokenData.access_token;

    // Exchange for long-lived user token (60 days)
    const llRes = await fetch(
      `${FB_API}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortToken}`
    );
    if (!llRes.ok) throw new Error(`Long-lived token exchange failed: ${await llRes.text()}`);
    const llData = (await llRes.json()) as { access_token: string };
    const longLivedToken = llData.access_token;

    type FbPage = { id: string; name: string; access_token: string; picture?: { data: { url: string } }; fan_count?: number };

    // Log which permissions were actually granted on this token
    try {
      const permRes = await fetch(`${FB_API}/me/permissions?access_token=${longLivedToken}`);
      if (permRes.ok) {
        const permData = (await permRes.json()) as { data: Array<{ permission: string; status: string }> };
        const granted = permData.data.filter((p) => p.status === "granted").map((p) => p.permission);
        const declined = permData.data.filter((p) => p.status === "declined").map((p) => p.permission);
        logger.info({ granted, declined }, "Facebook token permissions");
      }
    } catch (permErr) {
      logger.warn({ permErr }, "Could not fetch token permissions");
    }

    // Primary: pages the user directly admins
    const pagesRes = await fetch(`${FB_API}/me/accounts?access_token=${longLivedToken}&fields=id,name,picture,fan_count,access_token&limit=100`);
    const pagesRaw = await pagesRes.text();
    if (!pagesRes.ok) throw new Error(`Failed to fetch pages: ${pagesRaw}`);
    const pagesData = JSON.parse(pagesRaw) as { data: FbPage[]; error?: unknown };

    let allPages: FbPage[] = pagesData.data ?? [];
    logger.info({ pageCount: allPages.length, source: "me/accounts" }, "Facebook pages fetched");

    // Fallback: pages accessible via Business portfolios (Meta Business Suite)
    if (allPages.length === 0) {
      try {
        const bizRes = await fetch(`${FB_API}/me/businesses?access_token=${longLivedToken}&fields=id,name`);
        if (bizRes.ok) {
          const bizData = (await bizRes.json()) as { data: Array<{ id: string; name: string }> };
          logger.info({ businessCount: bizData.data?.length ?? 0 }, "Facebook businesses found");
          for (const biz of bizData.data ?? []) {
            const bpRes = await fetch(`${FB_API}/${biz.id}/owned_pages?access_token=${longLivedToken}&fields=id,name,picture,fan_count,access_token&limit=100`);
            if (bpRes.ok) {
              const bpData = (await bpRes.json()) as { data: FbPage[] };
              logger.info({ bizId: biz.id, bizName: biz.name, pageCount: bpData.data?.length ?? 0 }, "Business-owned pages");
              allPages = allPages.concat(bpData.data ?? []);
            }
          }
        }
      } catch (bizErr) {
        logger.warn({ bizErr }, "Business pages fallback failed — continuing");
      }
    }

    if (allPages.length === 0) {
      logger.warn("Facebook user has no managed pages (checked me/accounts + business portfolios)");
      res.redirect("/settings?oauth=facebook_no_pages");
      return;
    }

    let savedCount = 0;
    for (const page of allPages) {
      // Page tokens from long-lived user tokens never expire
      const pageToken = page.access_token;
      const pageId = page.id;
      const pageName = page.name;
      const thumbnailUrl = page.picture?.data?.url ?? null;
      const fanCount = page.fan_count ?? null;

      const existing = await db
        .select()
        .from(channelsTable)
        .where(and(eq(channelsTable.platform, "facebook"), eq(channelsTable.channelId, pageId)))
        .limit(1);

      if (existing.length > 0) {
        // Update token for existing page
        if (existing[0].tokenId) {
          await db.update(apiTokensTable)
            .set({ accessToken: pageToken, isActive: true, label: pageName })
            .where(eq(apiTokensTable.id, existing[0].tokenId));
        }
        await db.update(channelsTable)
          .set({ channelName: pageName, thumbnailUrl, subscriberCount: fanCount, isActive: true })
          .where(eq(channelsTable.id, existing[0].id));
      } else {
        // New page — insert token + channel
        const [newToken] = await db.insert(apiTokensTable)
          .values({ platform: "facebook", accessToken: pageToken, label: pageName, isActive: true })
          .returning();

        const existingFbPages = await db
          .select()
          .from(channelsTable)
          .where(and(eq(channelsTable.platform, "facebook"), eq(channelsTable.isActive, true)));

        await db.insert(channelsTable).values({
          platform: "facebook",
          channelId: pageId,
          channelName: pageName,
          thumbnailUrl,
          subscriberCount: fanCount,
          tokenId: newToken.id,
          isDefault: existingFbPages.length === 0,
          isActive: true,
        });
      }
      savedCount++;
    }

    logger.info({ savedCount }, "Facebook pages connected");
    res.redirect(`/settings?oauth=facebook_connected&pages=${savedCount}`);
  } catch (err) {
    logger.error({ err }, "Facebook OAuth callback failed");
    res.redirect("/settings?oauth=facebook_error");
  }
});

// ── Manual Page Token entry (dev-mode workaround) ────────────────────────────
router.post("/auth/facebook/manual-page", async (req, res): Promise<void> => {
  const { pageToken, pageId, pageName } = req.body as { pageToken?: string; pageId?: string; pageName?: string };
  if (!pageToken?.trim() || !pageId?.trim() || !pageName?.trim()) {
    res.status(400).json({ error: "pageToken, pageId, and pageName are all required." });
    return;
  }

  try {
    // Verify the token is valid and belongs to the given page
    const verifyRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}?fields=id,name,fan_count,picture&access_token=${pageToken}`);
    if (!verifyRes.ok) {
      const errBody = await verifyRes.text();
      logger.warn({ errBody }, "Manual Facebook token verification failed");
      res.status(400).json({ error: `Token verification failed: ${errBody}` });
      return;
    }
    const pageData = (await verifyRes.json()) as { id: string; name: string; fan_count?: number; picture?: { data: { url: string } }; error?: { message: string } };
    if (pageData.error) {
      res.status(400).json({ error: pageData.error.message });
      return;
    }

    const resolvedName = pageData.name ?? pageName;
    const thumbnailUrl = pageData.picture?.data?.url ?? null;
    const fanCount = pageData.fan_count ?? null;

    const existing = await db.select().from(channelsTable)
      .where(and(eq(channelsTable.platform, "facebook"), eq(channelsTable.channelId, pageId)))
      .limit(1);

    if (existing.length > 0) {
      if (existing[0].tokenId) {
        await db.update(apiTokensTable)
          .set({ accessToken: pageToken, isActive: true, label: resolvedName })
          .where(eq(apiTokensTable.id, existing[0].tokenId));
      }
      await db.update(channelsTable)
        .set({ channelName: resolvedName, thumbnailUrl, subscriberCount: fanCount, isActive: true })
        .where(eq(channelsTable.id, existing[0].id));
    } else {
      const [newToken] = await db.insert(apiTokensTable)
        .values({ platform: "facebook", accessToken: pageToken, label: resolvedName, isActive: true })
        .returning();

      const existingFbPages = await db.select().from(channelsTable)
        .where(and(eq(channelsTable.platform, "facebook"), eq(channelsTable.isActive, true)));

      await db.insert(channelsTable).values({
        platform: "facebook",
        channelId: pageId,
        channelName: resolvedName,
        thumbnailUrl,
        subscriberCount: fanCount,
        tokenId: newToken.id,
        isDefault: existingFbPages.length === 0,
        isActive: true,
      });
    }

    logger.info({ pageId, pageName: resolvedName }, "Facebook page connected via manual token");
    res.json({ ok: true, pageName: resolvedName });
  } catch (err) {
    logger.error({ err }, "Manual Facebook token save failed");
    res.status(500).json({ error: "Internal error saving token." });
  }
});

// ── List connected Facebook pages ─────────────────────────────────────────────
router.get("/auth/facebook/pages", async (_req, res): Promise<void> => {
  const pages = await db
    .select()
    .from(channelsTable)
    .where(and(eq(channelsTable.platform, "facebook"), eq(channelsTable.isActive, true)));
  res.json(pages);
});

// ── Set default page ──────────────────────────────────────────────────────────
router.post("/auth/facebook/pages/:id/default", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  await db.update(channelsTable).set({ isDefault: false }).where(eq(channelsTable.platform, "facebook"));
  await db.update(channelsTable).set({ isDefault: true }).where(eq(channelsTable.id, id));
  res.json({ ok: true });
});

// ── Disconnect page ───────────────────────────────────────────────────────────
router.delete("/auth/facebook/pages/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [page] = await db.select().from(channelsTable).where(eq(channelsTable.id, id)).limit(1);
  if (!page) { res.status(404).json({ error: "Page not found" }); return; }

  await db.update(channelsTable).set({ isActive: false }).where(eq(channelsTable.id, id));
  if (page.tokenId) {
    await db.update(apiTokensTable).set({ isActive: false }).where(eq(apiTokensTable.id, page.tokenId));
  }

  if (page.isDefault) {
    const [next] = await db
      .select()
      .from(channelsTable)
      .where(and(eq(channelsTable.platform, "facebook"), eq(channelsTable.isActive, true)))
      .limit(1);
    if (next) await db.update(channelsTable).set({ isDefault: true }).where(eq(channelsTable.id, next.id));
  }

  res.sendStatus(204);
});

// ── Status check ──────────────────────────────────────────────────────────────
router.get("/auth/facebook/status", async (_req, res): Promise<void> => {
  const pages = await db
    .select()
    .from(channelsTable)
    .where(and(eq(channelsTable.platform, "facebook"), eq(channelsTable.isActive, true)));

  const appId = await getConfig("FACEBOOK_APP_ID");
  const appSecret = await getConfig("FACEBOOK_APP_SECRET");

  const def = pages.find((p) => p.isDefault) ?? pages[0] ?? null;
  res.json({
    connected: pages.length > 0,
    pageCount: pages.length,
    credentialsConfigured: !!(appId && appSecret),
    pageName: def?.channelName ?? null,
    pageId: def?.channelId ?? null,
    fanCount: def?.subscriberCount ?? null,
    thumbnailUrl: def?.thumbnailUrl ?? null,
  });
});

export default router;
