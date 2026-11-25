import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { writeFileSync, existsSync, unlinkSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { db, appConfigTable } from "@workspace/db";

const LOGO_FILE_PATH = "/home/runner/workspace/artifacts/api-server/assets/watermark-logo.png";
const LOGO_TMP_PATH  = "/tmp/watermark-upload-raw";
const ASSETS_DIR     = "/home/runner/workspace/artifacts/api-server/assets";

const router: IRouter = Router();

const ALLOWED_KEYS = [
  "YOUTUBE_CLIENT_ID",
  "YOUTUBE_CLIENT_SECRET",
  "FACEBOOK_APP_ID",
  "FACEBOOK_APP_SECRET",
] as const;

type AllowedKey = (typeof ALLOWED_KEYS)[number];

export const YT_COOKIES_PATH = "/tmp/n3xus-yt-cookies.txt";
const YT_COOKIES_DB_KEY = "yt_cookies";

// Restore cookies file from DB on startup
async function restoreCookiesFile() {
  try {
    const [row] = await db
      .select()
      .from(appConfigTable)
      .where(eq(appConfigTable.key, YT_COOKIES_DB_KEY))
      .limit(1);
    if (row?.value) {
      writeFileSync(YT_COOKIES_PATH, row.value, "utf-8");
    }
  } catch {
    // noop
  }
}
restoreCookiesFile();

// GET /api/settings/credentials — returns which keys are set (values masked)
router.get("/settings/credentials", async (_req, res): Promise<void> => {
  const rows = await db
    .select({ key: appConfigTable.key, updatedAt: appConfigTable.updatedAt })
    .from(appConfigTable);

  const result: Record<string, { set: boolean; updatedAt: string | null }> = {};
  for (const key of ALLOWED_KEYS) {
    result[key] = { set: false, updatedAt: null };
  }
  for (const row of rows) {
    if (ALLOWED_KEYS.includes(row.key as AllowedKey)) {
      result[row.key] = {
        set: true,
        updatedAt: row.updatedAt.toISOString(),
      };
    }
  }

  res.json(result);
});

// POST /api/settings/credentials — upsert one or more credentials
router.post("/settings/credentials", async (req, res): Promise<void> => {
  const body = req.body as { credentials?: Record<string, string> };

  if (!body?.credentials || typeof body.credentials !== "object") {
    res.status(400).json({ error: "Invalid request body — expected { credentials: { KEY: value } }" });
    return;
  }

  let saved = 0;
  for (const [key, value] of Object.entries(body.credentials)) {
    if (!ALLOWED_KEYS.includes(key as AllowedKey)) continue;
    const trimmed = String(value).trim();
    if (!trimmed) continue;

    await db
      .insert(appConfigTable)
      .values({ key, value: trimmed })
      .onConflictDoUpdate({
        target: appConfigTable.key,
        set: { value: trimmed, updatedAt: new Date() },
      });
    saved++;
  }

  res.json({ ok: true, saved });
});

// DELETE /api/settings/credentials/:key — remove a credential
router.delete("/settings/credentials/:key", async (req, res): Promise<void> => {
  const key = req.params.key;
  if (!ALLOWED_KEYS.includes(key as AllowedKey)) {
    res.status(400).json({ error: "Unknown credential key" });
    return;
  }
  await db.delete(appConfigTable).where(eq(appConfigTable.key, key));
  res.sendStatus(204);
});

// ── YouTube Cookies ─────────────────────────────────────────────────────────

// GET /api/settings/yt-cookies — returns { set: bool, updatedAt }
router.get("/settings/yt-cookies", async (_req, res): Promise<void> => {
  const [row] = await db
    .select({ updatedAt: appConfigTable.updatedAt })
    .from(appConfigTable)
    .where(eq(appConfigTable.key, YT_COOKIES_DB_KEY))
    .limit(1);
  res.json({ set: !!row, updatedAt: row?.updatedAt?.toISOString() ?? null });
});

// POST /api/settings/yt-cookies — save Netscape cookie file content
router.post("/settings/yt-cookies", async (req, res): Promise<void> => {
  const body = req.body as { cookies?: string };
  const content = (body?.cookies ?? "").trim();
  if (!content) {
    res.status(400).json({ error: "No cookies content provided" });
    return;
  }

  await db
    .insert(appConfigTable)
    .values({ key: YT_COOKIES_DB_KEY, value: content })
    .onConflictDoUpdate({
      target: appConfigTable.key,
      set: { value: content, updatedAt: new Date() },
    });

  // Write to disk for immediate use by yt-dlp
  writeFileSync(YT_COOKIES_PATH, content, "utf-8");

  res.json({ ok: true });
});

// DELETE /api/settings/yt-cookies — remove cookies
router.delete("/settings/yt-cookies", async (_req, res): Promise<void> => {
  await db.delete(appConfigTable).where(eq(appConfigTable.key, YT_COOKIES_DB_KEY));
  try { if (existsSync(YT_COOKIES_PATH)) unlinkSync(YT_COOKIES_PATH); } catch { /* noop */ }
  res.sendStatus(204);
});

// ── Watermark Logo ───────────────────────────────────────────────────────────

// GET /api/settings/watermark-logo — returns { set: bool }
router.get("/settings/watermark-logo", (_req, res): void => {
  res.json({ set: existsSync(LOGO_FILE_PATH) });
});

// POST /api/settings/watermark-logo — upload new logo (body: { data: "data:image/...;base64,..." })
router.post("/settings/watermark-logo", async (req, res): Promise<void> => {
  const body = req.body as { data?: string };
  if (!body?.data) {
    res.status(400).json({ error: "Missing image data (expected { data: base64String })" });
    return;
  }

  // Strip the data URI prefix if present
  const stripped = body.data.replace(/^data:image\/[a-z+]+;base64,/i, "");
  const buf = Buffer.from(stripped, "base64");
  if (buf.length < 200) {
    res.status(400).json({ error: "Image data too small — upload appears invalid" });
    return;
  }

  try {
    mkdirSync(ASSETS_DIR, { recursive: true });
    writeFileSync(LOGO_TMP_PATH, buf);
    // Use ImageMagick to remove black background and save as transparent PNG
    execSync(`magick "${LOGO_TMP_PATH}" -fuzz 22% -transparent black "${LOGO_FILE_PATH}"`, { timeout: 30_000 });
    try { unlinkSync(LOGO_TMP_PATH); } catch { /* noop */ }
    res.json({ ok: true });
  } catch (err) {
    // Fallback: save raw bytes directly (no background removal)
    try {
      writeFileSync(LOGO_FILE_PATH, buf);
      res.json({ ok: true, warn: "Background removal failed — logo saved as-is" });
    } catch (e2) {
      res.status(500).json({ error: "Failed to save logo file" });
    }
  }
});

// DELETE /api/settings/watermark-logo — remove logo (revert to text watermark)
router.delete("/settings/watermark-logo", (_req, res): void => {
  try { if (existsSync(LOGO_FILE_PATH)) unlinkSync(LOGO_FILE_PATH); } catch { /* noop */ }
  res.sendStatus(204);
});

export default router;
