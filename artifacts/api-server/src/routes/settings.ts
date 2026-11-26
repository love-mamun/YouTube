import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { eq } from "drizzle-orm";
import { writeFileSync, existsSync, unlinkSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import * as path from "path";
import { db, appConfigTable } from "@workspace/db";
import {
  YT_COOKIES_DB_KEY,
  YT_COOKIES_PATH,
  YT_PROXY_DB_KEY,
  validateNetscapeCookies,
  parseAndValidateProxyList,
  getMaskedProxyStatus,
  getStoredProxyList,
  saveStoredProxyList,
  removeProxyFromStoredPool,
  setProxyAutoPruneEnabled,
} from "../lib/ytdlp-config";
import { runYtDlpDiagnostics, pruneAndRankProxyPool } from "../lib/ytdlp-downloader";
import {
  BUILTIN_GITHUB_PROXY_FEEDS,
  getLastScrapeReport,
  getScraperTokenStatus,
  getStoredScraperConfig,
  isProxyScrapeRunning,
  revokeScraperTriggerToken,
  rotateScraperTriggerToken,
  saveStoredScraperConfig,
  validateScraperConfigInput,
} from "../lib/proxy-scraper";

const ASSETS_DIR     = path.resolve(process.cwd(), "artifacts/api-server/assets");
const LOGO_FILE_PATH = path.join(ASSETS_DIR, "watermark-logo.png");
const LOGO_TMP_PATH  = "/tmp/watermark-upload-raw";

const router: IRouter = Router();

const ALLOWED_KEYS = [
  "YOUTUBE_CLIENT_ID",
  "YOUTUBE_CLIENT_SECRET",
  "FACEBOOK_APP_ID",
  "FACEBOOK_APP_SECRET",
] as const;

type AllowedKey = (typeof ALLOWED_KEYS)[number];

export { YT_COOKIES_PATH };

function requireSettingsAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.session?.settingsAuthed !== true) {
    res.status(401).json({ error: "Settings access locked. Unlock Settings first." });
    return;
  }
  next();
}

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
  const key = Array.isArray(req.params.key) ? req.params.key[0] : req.params.key;
  if (!ALLOWED_KEYS.includes(key as AllowedKey)) {
    res.status(400).json({ error: "Unknown credential key" });
    return;
  }
  await db.delete(appConfigTable).where(eq(appConfigTable.key, key));
  res.sendStatus(204);
});

// ── YouTube Cookies ─────────────────────────────────────────────────────────

// GET /api/settings/yt-cookies — returns { set, updatedAt, validation } (never plaintext cookies)
router.get("/settings/yt-cookies", async (_req, res): Promise<void> => {
  const [row] = await db
    .select({ value: appConfigTable.value, updatedAt: appConfigTable.updatedAt })
    .from(appConfigTable)
    .where(eq(appConfigTable.key, YT_COOKIES_DB_KEY))
    .limit(1);

  if (!row?.value) {
    res.json({ set: false, updatedAt: null, validation: null });
    return;
  }

  const validation = validateNetscapeCookies(row.value);
  res.json({
    set: true,
    updatedAt: row.updatedAt.toISOString(),
    validation,
  });
});

// POST /api/settings/yt-cookies — validate & save Netscape cookie file content
router.post("/settings/yt-cookies", requireSettingsAuth, async (req, res): Promise<void> => {
  const body = req.body as { cookies?: string };
  const content = (body?.cookies ?? "").trim();
  if (!content) {
    res.status(400).json({ error: "No cookies content provided" });
    return;
  }

  const validation = validateNetscapeCookies(content);
  if (validation.status === "invalid_format" || validation.status === "not_youtube") {
    res.status(400).json({
      error: validation.warnings[0] || "Invalid Netscape YouTube cookie file.",
      validation,
    });
    return;
  }
  if (validation.status === "missing_auth" || validation.status === "expired") {
    res.status(400).json({
      error:
        validation.warnings[0] ||
        "Cookies are expired or do not include an active YouTube login session. Re-export while signed in.",
      validation,
    });
    return;
  }

  await db
    .insert(appConfigTable)
    .values({ key: YT_COOKIES_DB_KEY, value: content })
    .onConflictDoUpdate({
      target: appConfigTable.key,
      set: { value: content, updatedAt: new Date() },
    });

  // Write canonical copy to disk with strict permissions
  writeFileSync(YT_COOKIES_PATH, content, { encoding: "utf-8", mode: 0o600 });

  res.json({ ok: true, validation });
});

// DELETE /api/settings/yt-cookies — remove cookies
router.delete("/settings/yt-cookies", requireSettingsAuth, async (_req, res): Promise<void> => {
  await db.delete(appConfigTable).where(eq(appConfigTable.key, YT_COOKIES_DB_KEY));
  try { if (existsSync(YT_COOKIES_PATH)) unlinkSync(YT_COOKIES_PATH); } catch { /* noop */ }
  res.sendStatus(204);
});

// ── Optional Download Proxy ──────────────────────────────────────────────────

// GET /api/settings/yt-proxy — returns masked host summary only (never credentials)
router.get("/settings/yt-proxy", requireSettingsAuth, async (_req, res): Promise<void> => {
  const status = await getMaskedProxyStatus();
  res.json(status);
});

// POST /api/settings/yt-proxy — validate SSRF-safely & save single or multi-proxy list
router.post("/settings/yt-proxy", requireSettingsAuth, async (req, res): Promise<void> => {
  const body = req.body as { proxyUrl?: string };
  const check = parseAndValidateProxyList(body?.proxyUrl ?? "");
  if (!check.ok) {
    res.status(400).json({ error: check.error });
    return;
  }

  await saveStoredProxyList(check.proxies);
  const status = await getMaskedProxyStatus();

  res.json({
    ok: true,
    set: true,
    count: check.proxies.length,
    maskedHost: check.summary,
    maskedProxies: check.maskedList,
    autoPrune: status.autoPrune,
  });
});

// POST /api/settings/yt-proxy/prune — test proxies via HTTPS CONNECT & optionally keep working-only
router.post("/settings/yt-proxy/prune", requireSettingsAuth, async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as {
    proxyUrl?: string;
    saveWorkingOnly?: boolean;
  };

  let targets: string[];
  if (typeof body.proxyUrl === "string" && body.proxyUrl.trim()) {
    const check = parseAndValidateProxyList(body.proxyUrl);
    if (!check.ok) {
      res.status(400).json({ error: check.error });
      return;
    }
    targets = check.proxies;
  } else {
    targets = await getStoredProxyList();
    if (targets.length === 0) {
      res.status(400).json({ error: "No saved proxies found in pool to prune." });
      return;
    }
  }

  const pruneResult = await pruneAndRankProxyPool(targets);
  let saved = false;
  if (body.saveWorkingOnly === true && pruneResult.workingProxies.length > 0) {
    await saveStoredProxyList(pruneResult.workingProxies);
    saved = true;
  }

  const status = await getMaskedProxyStatus();
  res.json({
    total: pruneResult.total,
    workingCount: pruneResult.workingCount,
    removedCount: pruneResult.removedCount,
    results: pruneResult.results,
    saved,
    status,
  });
});

// POST /api/settings/yt-proxy/autoprune — toggle runtime auto-pruning of failing proxies
router.post("/settings/yt-proxy/autoprune", requireSettingsAuth, async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") {
    res.status(400).json({ error: "Expected boolean { enabled }" });
    return;
  }
  await setProxyAutoPruneEnabled(body.enabled);
  res.json({ ok: true, autoPrune: body.enabled });
});

// DELETE /api/settings/yt-proxy/entry — remove a single proxy from saved pool
router.delete("/settings/yt-proxy/entry", requireSettingsAuth, async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as { index?: unknown; maskedHost?: unknown };
  const idx =
    typeof body.index === "number" && Number.isInteger(body.index) ? body.index : undefined;
  const maskedHost = typeof body.maskedHost === "string" ? body.maskedHost.trim() : undefined;

  if (idx === undefined && !maskedHost) {
    res.status(400).json({ error: "Specify proxy index or maskedHost to remove." });
    return;
  }

  const result = await removeProxyFromStoredPool({ index: idx, maskedHost });
  const status = await getMaskedProxyStatus();
  res.json({ ok: result.removed, ...result, status });
});

// DELETE /api/settings/yt-proxy — remove saved proxy
router.delete("/settings/yt-proxy", requireSettingsAuth, async (_req, res): Promise<void> => {
  await db.delete(appConfigTable).where(eq(appConfigTable.key, YT_PROXY_DB_KEY));
  res.sendStatus(204);
});

// ── GitHub Proxy Auto-Scraper Configuration & Trigger Token ──────────────────

router.get("/settings/proxy-scraper", requireSettingsAuth, async (_req, res): Promise<void> => {
  const [config, tokenStatus, lastRun] = await Promise.all([
    getStoredScraperConfig(),
    getScraperTokenStatus(),
    getLastScrapeReport(),
  ]);
  res.json({
    builtinFeeds: BUILTIN_GITHUB_PROXY_FEEDS,
    enabledFeedIds: config.enabledFeedIds,
    customUrls: config.customUrls,
    tokenConfigured: tokenStatus.configured,
    tokenUpdatedAt: tokenStatus.updatedAt,
    lastRun,
    running: isProxyScrapeRunning(),
  });
});

router.put("/settings/proxy-scraper", requireSettingsAuth, async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as { enabledFeedIds?: unknown; customUrls?: unknown };
  const check = validateScraperConfigInput(body);
  if (!check.ok) {
    res.status(400).json({ error: check.error });
    return;
  }
  await saveStoredScraperConfig(check.config);
  res.json({
    ok: true,
    enabledFeedIds: check.config.enabledFeedIds,
    customUrls: check.config.customUrls,
  });
});

router.post("/settings/proxy-scraper/token/rotate", requireSettingsAuth, async (_req, res): Promise<void> => {
  const rotated = await rotateScraperTriggerToken();
  res.json({
    ok: true,
    token: rotated.token,
    updatedAt: rotated.updatedAt,
  });
});

router.delete("/settings/proxy-scraper/token", requireSettingsAuth, async (_req, res): Promise<void> => {
  await revokeScraperTriggerToken();
  res.sendStatus(204);
});

// ── YouTube / yt-dlp Diagnostics Probe ───────────────────────────────────────

const SAFE_YT_URL_RE =
  /^https:\/\/(?:www\.|m\.)?(?:youtube\.com\/watch\?v=[a-zA-Z0-9_-]{11}|youtu\.be\/[a-zA-Z0-9_-]{11})(?:[&?].*)?$/;

router.post("/settings/yt-diagnostics/test", requireSettingsAuth, async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as {
    proxyUrl?: string;
    testUrl?: string;
    runLiveProbe?: boolean;
  };

  let proxyListOverride: string[] | undefined = undefined;
  if (typeof body.proxyUrl === "string" && body.proxyUrl.trim()) {
    const check = parseAndValidateProxyList(body.proxyUrl);
    if (!check.ok) {
      res.status(400).json({ error: check.error });
      return;
    }
    proxyListOverride = check.proxies;
  }

  let safeTestUrl: string | undefined = undefined;
  if (typeof body.testUrl === "string" && body.testUrl.trim()) {
    const trimmedUrl = body.testUrl.trim();
    if (!SAFE_YT_URL_RE.test(trimmedUrl)) {
      res.status(400).json({
        error: "Diagnostic URL must be a valid https://youtube.com/watch?v=... or https://youtu.be/... video URL.",
      });
      return;
    }
    safeTestUrl = trimmedUrl;
  }

  const [cookieRow] = await db
    .select({ value: appConfigTable.value })
    .from(appConfigTable)
    .where(eq(appConfigTable.key, YT_COOKIES_DB_KEY))
    .limit(1);

  const cookieValidation = cookieRow?.value ? validateNetscapeCookies(cookieRow.value) : null;
  const report = await runYtDlpDiagnostics({
    testUrl: safeTestUrl,
    proxyListOverride,
    runLiveProbe: body.runLiveProbe !== false,
  });

  res.json({
    ...report,
    cookies: cookieValidation
      ? { set: true, validation: cookieValidation }
      : { set: false, validation: null },
  });
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
  } catch {
    // Fallback: save raw bytes directly (no background removal)
    try {
      writeFileSync(LOGO_FILE_PATH, buf);
      res.json({ ok: true, warn: "Background removal failed — logo saved as-is" });
    } catch {
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
