import { existsSync, mkdirSync, writeFileSync, unlinkSync, statfsSync } from "fs";
import * as os from "os";
import * as path from "path";
import * as net from "net";
import { eq } from "drizzle-orm";
import { db, appConfigTable } from "@workspace/db";
import { logger } from "./logger";

export const YT_COOKIES_DB_KEY = "yt_cookies";
export const YT_PROXY_DB_KEY = "YTDLP_PROXY_URL";
export const YT_COOKIES_PATH = "/tmp/n3xus-yt-cookies.txt";
export const POT_HTTP_URL = process.env.BGUTIL_POT_URL || "http://127.0.0.1:4416";

export function getVideoStoreDir(): string {
  const custom = process.env.VIDEO_STORE_DIR?.trim();
  const dir = custom || path.join(os.tmpdir(), "n3xus-video-store");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export interface DiskSpaceInfo {
  path: string;
  persistentConfigured: boolean;
  totalMB: number | null;
  availableMB: number | null;
  usedMB: number | null;
}

export function getDiskSpaceInfo(targetDir?: string): DiskSpaceInfo {
  const dir = targetDir || getVideoStoreDir();
  const persistentConfigured = Boolean(process.env.VIDEO_STORE_DIR?.trim());
  try {
    const stats = statfsSync(dir);
    const bsize = Number(stats.bsize || 4096);
    const totalBytes = Number(stats.blocks) * bsize;
    const availBytes = Number(stats.bavail) * bsize;
    const usedBytes = Math.max(0, totalBytes - availBytes);
    return {
      path: dir,
      persistentConfigured,
      totalMB: Math.round(totalBytes / (1024 * 1024)),
      availableMB: Math.round(availBytes / (1024 * 1024)),
      usedMB: Math.round(usedBytes / (1024 * 1024)),
    };
  } catch {
    return {
      path: dir,
      persistentConfigured,
      totalMB: null,
      availableMB: null,
      usedMB: null,
    };
  }
}

const YTDLP_PYTHONPATH = "/home/runner/workspace/.pythonlibs/lib/python3.12/site-packages";
const BASE_YTDLP_ENV = {
  ...process.env,
  NO_PROXY: "127.0.0.1,localhost",
  no_proxy: "127.0.0.1,localhost",
};
export const YTDLP_ENV = existsSync(YTDLP_PYTHONPATH)
  ? { ...BASE_YTDLP_ENV, PYTHONPATH: YTDLP_PYTHONPATH }
  : BASE_YTDLP_ENV;

export const NODE_BIN = process.execPath ?? "node";
export const JS_RUNTIME_ARGS = ["--js-runtimes", `node:${NODE_BIN}`];
export const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const BGUTIL_SERVER_CANDIDATES = [
  process.env.BGUTIL_SERVER_HOME,
  "/opt/bgutil-ytdlp-pot-provider/server",
  path.resolve(process.cwd(), "bgutil-ytdlp-pot-provider/server"),
].filter((p): p is string => Boolean(p));

// ── Cookie Validation ────────────────────────────────────────────────────────

const CORE_SESSION_COOKIES = ["SID", "__Secure-1PSID", "__Secure-3PSID", "SAPISID", "LOGIN_INFO"];
const RECOMMENDED_AUTH_COOKIES = [
  "SID",
  "HSID",
  "SSID",
  "APISID",
  "SAPISID",
  "LOGIN_INFO",
  "__Secure-1PSID",
  "__Secure-3PSID",
];

export type CookieHealthStatus =
  | "valid"
  | "expiring_soon"
  | "expired"
  | "missing_auth"
  | "not_youtube"
  | "invalid_format";

export interface CookieValidationResult {
  valid: boolean;
  status: CookieHealthStatus;
  cookieCount: number;
  ytCookieCount: number;
  malformedLines: number;
  foundAuthCookies: string[];
  missingRecommended: string[];
  expiredCount: number;
  earliestExpiry: string | null;
  warnings: string[];
}

export function validateNetscapeCookies(raw: string): CookieValidationResult {
  const lines = raw.split(/\r?\n/);
  let cookieCount = 0;
  let ytCookieCount = 0;
  let malformedLines = 0;
  let expiredAuthCount = 0;
  let expiringSoonAuthCount = 0;
  let validCoreSessionCount = 0;
  let earliestExpirySecs: number | null = null;

  const foundAuthSet = new Set<string>();
  const nowSecs = Math.floor(Date.now() / 1000);
  const sevenDaysSecs = 7 * 24 * 60 * 60;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    // Netscape header/comments, except #HttpOnly_ lines which are real cookies
    if (trimmed.startsWith("#") && !trimmed.startsWith("#HttpOnly_")) continue;

    const cleanLine = trimmed.startsWith("#HttpOnly_")
      ? trimmed.slice("#HttpOnly_".length)
      : trimmed;

    const parts = cleanLine.split("\t");
    if (parts.length < 7) {
      malformedLines++;
      continue;
    }

    const domain = parts[0].trim().toLowerCase();
    const flag = parts[1].trim().toUpperCase();
    const expiryRaw = Number(parts[4].trim());
    const name = parts[5].trim();

    if (!domain || (flag !== "TRUE" && flag !== "FALSE") || Number.isNaN(expiryRaw) || !name) {
      malformedLines++;
      continue;
    }

    cookieCount++;
    const isYtOrGoogle =
      domain.endsWith("youtube.com") ||
      domain === "youtube.com" ||
      domain.endsWith("google.com") ||
      domain === "google.com";

    if (isYtOrGoogle) {
      ytCookieCount++;
    }

    if (RECOMMENDED_AUTH_COOKIES.includes(name) && isYtOrGoogle) {
      foundAuthSet.add(name);
      const isCore = CORE_SESSION_COOKIES.includes(name);
      if (expiryRaw > 0) {
        if (expiryRaw <= nowSecs) {
          if (isCore) expiredAuthCount++;
        } else {
          if (isCore) validCoreSessionCount++;
          if (earliestExpirySecs === null || expiryRaw < earliestExpirySecs) {
            earliestExpirySecs = expiryRaw;
          }
          if (expiryRaw - nowSecs <= sevenDaysSecs) {
            expiringSoonAuthCount++;
          }
        }
      } else if (isCore) {
        // Session cookie (expiry === 0)
        validCoreSessionCount++;
      }
    }
  }

  const foundAuthCookies = Array.from(foundAuthSet);
  const missingRecommended = RECOMMENDED_AUTH_COOKIES.filter((c) => !foundAuthSet.has(c));
  const corePresentCount = CORE_SESSION_COOKIES.filter((c) => foundAuthSet.has(c)).length;

  const warnings: string[] = [];
  let status: CookieHealthStatus = "valid";

  if (cookieCount === 0) {
    status = "invalid_format";
    warnings.push("No valid Netscape tab-separated cookie rows found.");
  } else if (ytCookieCount === 0) {
    status = "not_youtube";
    warnings.push("Cookies do not belong to youtube.com or google.com.");
  } else if (corePresentCount === 0) {
    status = "missing_auth";
    warnings.push(
      "No signed-in YouTube auth cookies found (missing SID, __Secure-1PSID, __Secure-3PSID, SAPISID, LOGIN_INFO)."
    );
  } else if (validCoreSessionCount === 0 && expiredAuthCount > 0) {
    status = "expired";
    warnings.push("All core YouTube session cookies in this export are expired. Re-export fresh cookies.");
  } else if (expiringSoonAuthCount > 0 || expiredAuthCount > 0) {
    status = "expiring_soon";
    if (expiredAuthCount > 0) {
      warnings.push(`${expiredAuthCount} auth cookie(s) have expired; consider re-exporting.`);
    }
    if (expiringSoonAuthCount > 0) {
      warnings.push("Some auth cookies expire within 7 days.");
    }
  }

  if (malformedLines > 0 && cookieCount > 0) {
    warnings.push(`Ignored ${malformedLines} malformed line(s).`);
  }

  return {
    valid: status === "valid" || status === "expiring_soon",
    status,
    cookieCount,
    ytCookieCount,
    malformedLines,
    foundAuthCookies,
    missingRecommended,
    expiredCount: expiredAuthCount,
    earliestExpiry: earliestExpirySecs ? new Date(earliestExpirySecs * 1000).toISOString() : null,
    warnings,
  };
}

// ── Cookie File Sync & Per-Job Temp Copy ─────────────────────────────────────

export async function syncCookiesFromDb(): Promise<boolean> {
  try {
    const [row] = await db
      .select()
      .from(appConfigTable)
      .where(eq(appConfigTable.key, YT_COOKIES_DB_KEY))
      .limit(1);
    if (row?.value) {
      writeFileSync(YT_COOKIES_PATH, row.value, { encoding: "utf-8", mode: 0o600 });
      return true;
    }
    return false;
  } catch (err) {
    logger.warn({ err }, "Failed to restore YouTube cookies from DB");
    return false;
  }
}

export async function acquireJobCookieCopy(
  tag: string
): Promise<{ path: string | null; hasCookies: boolean; cleanup: () => void }> {
  if (!existsSync(YT_COOKIES_PATH)) {
    await syncCookiesFromDb();
  }
  if (!existsSync(YT_COOKIES_PATH)) {
    return { path: null, hasCookies: false, cleanup: () => {} };
  }

  // Copy to a unique temp path per yt-dlp invocation so yt-dlp's Set-Cookie
  // writeback or concurrent downloads never mutate the canonical cookie file.
  const dir = path.join(os.tmpdir(), "n3xus-cookie-runs");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const safeTag = tag.replace(/[^a-zA-Z0-9_-]/g, "");
  const copyPath = path.join(dir, `${safeTag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`);

  try {
    const { readFileSync } = await import("fs");
    const content = readFileSync(YT_COOKIES_PATH, "utf-8");
    if (!content.trim()) {
      return { path: null, hasCookies: false, cleanup: () => {} };
    }
    writeFileSync(copyPath, content, { encoding: "utf-8", mode: 0o600 });
    return {
      path: copyPath,
      hasCookies: true,
      cleanup: () => {
        try {
          if (existsSync(copyPath)) unlinkSync(copyPath);
        } catch {
          // noop
        }
      },
    };
  } catch {
    return { path: YT_COOKIES_PATH, hasCookies: existsSync(YT_COOKIES_PATH), cleanup: () => {} };
  }
}

// ── Proxy Validation & Storage ───────────────────────────────────────────────

const ALLOWED_PROXY_PROTOCOLS = new Set(["http:", "https:", "socks4:", "socks4a:", "socks5:", "socks5h:"]);

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return true;
  if (
    host === "localhost" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    return true;
  }

  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }

  if (net.isIPv6(host)) {
    if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) {
      return true;
    }
  }
  return false;
}

export function maskProxyUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    const creds = parsed.username || parsed.password ? "***@" : "";
    const port = parsed.port ? `:${parsed.port}` : "";
    return `${parsed.protocol}//${creds}${parsed.hostname}${port}`;
  } catch {
    return "***";
  }
}

export function validateAndNormalizeProxyUrl(
  raw: string
): { ok: true; normalized: string; masked: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: "Proxy URL is empty." };
  }
  if (/[\r\n\s]/.test(trimmed)) {
    return { ok: false, error: "Proxy URL cannot contain spaces or newlines." };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      ok: false,
      error: "Invalid proxy URL format. Expected http://user:pass@host:port or socks5://host:port.",
    };
  }

  if (!ALLOWED_PROXY_PROTOCOLS.has(parsed.protocol)) {
    return {
      ok: false,
      error: `Unsupported proxy scheme "${parsed.protocol}". Use http://, https://, socks5://, or socks4://.`,
    };
  }

  if (!parsed.hostname || isPrivateOrLoopbackHost(parsed.hostname)) {
    return {
      ok: false,
      error: "Proxy hostname cannot be empty, localhost, loopback, or a private network address.",
    };
  }

  if (!parsed.port) {
    return {
      ok: false,
      error: "Proxy URL must include a port number (e.g., :8080 or :1080).",
    };
  }

  const portNum = Number(parsed.port);
  if (Number.isNaN(portNum) || portNum < 1 || portNum > 65535) {
    return { ok: false, error: "Proxy port must be between 1 and 65535." };
  }

  return {
    ok: true,
    normalized: parsed.toString(),
    masked: maskProxyUrl(parsed.toString()),
  };
}

export async function getStoredProxyUrl(): Promise<string | null> {
  try {
    const [row] = await db
      .select({ value: appConfigTable.value })
      .from(appConfigTable)
      .where(eq(appConfigTable.key, YT_PROXY_DB_KEY))
      .limit(1);
    const val = row?.value?.trim();
    return val || null;
  } catch {
    return null;
  }
}

export async function getMaskedProxyStatus(): Promise<{
  set: boolean;
  maskedHost: string | null;
  updatedAt: string | null;
}> {
  const [row] = await db
    .select({ value: appConfigTable.value, updatedAt: appConfigTable.updatedAt })
    .from(appConfigTable)
    .where(eq(appConfigTable.key, YT_PROXY_DB_KEY))
    .limit(1);

  if (!row?.value) {
    return { set: false, maskedHost: null, updatedAt: null };
  }
  return {
    set: true,
    maskedHost: maskProxyUrl(row.value),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ── PO Token Provider Discovery ──────────────────────────────────────────────

export interface PotProviderStatus {
  mode: "http" | "script" | "none";
  httpAvailable: boolean;
  httpUrl: string;
  scriptAvailable: boolean;
  scriptServerHome: string | null;
  extractorArgs: string[];
}

export async function detectPotProvider(): Promise<PotProviderStatus> {
  let httpAvailable = false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    const res = await fetch(`${POT_HTTP_URL}/ping`, { signal: controller.signal });
    clearTimeout(timer);
    // Any HTTP response from 127.0.0.1:4416 (even 404 on unknown route) means the Node server is up.
    httpAvailable = res.status > 0;
  } catch {
    httpAvailable = false;
  }

  let scriptServerHome: string | null = null;
  for (const candidate of BGUTIL_SERVER_CANDIDATES) {
    if (existsSync(path.join(candidate, "build", "generate_once.js"))) {
      scriptServerHome = candidate;
      break;
    }
  }

  if (httpAvailable) {
    return {
      mode: "http",
      httpAvailable: true,
      httpUrl: POT_HTTP_URL,
      scriptAvailable: Boolean(scriptServerHome),
      scriptServerHome,
      extractorArgs: ["--extractor-args", `youtubepot-bgutilhttp:base_url=${POT_HTTP_URL}`],
    };
  }

  if (scriptServerHome) {
    return {
      mode: "script",
      httpAvailable: false,
      httpUrl: POT_HTTP_URL,
      scriptAvailable: true,
      scriptServerHome,
      extractorArgs: ["--extractor-args", `youtubepot-bgutilscript:server_home=${scriptServerHome}`],
    };
  }

  return {
    mode: "none",
    httpAvailable: false,
    httpUrl: POT_HTTP_URL,
    scriptAvailable: false,
    scriptServerHome: null,
    extractorArgs: [],
  };
}

// ── Categorized yt-dlp Error Classification ──────────────────────────────────

export type YtDlpErrorCode =
  | "RATE_LIMITED_429"
  | "COOKIES_EXPIRED"
  | "BOT_CHECK"
  | "4K_UNAVAILABLE"
  | "PROXY_ERROR"
  | "POT_UNAVAILABLE"
  | "FORMAT_UNAVAILABLE"
  | "STREAM_STALLED"
  | "DISK_FULL"
  | "CANCELLED"
  | "YTDLP_ERROR";

export function classifyYtDlpError(
  rawMessage: string,
  context?: {
    quality?: string | null;
    usedCookies?: boolean;
    usedProxy?: boolean;
    proxyMaskedHost?: string | null;
    potMode?: string;
  }
): { code: YtDlpErrorCode; formattedMessage: string } {
  const msg = rawMessage.trim();

  if (/\[CANCELLED\]|Stopped by user/i.test(msg)) {
    return { code: "CANCELLED", formattedMessage: "[CANCELLED] Stopped by user." };
  }

  if (/\[4K_UNAVAILABLE\]/i.test(msg)) {
    return { code: "4K_UNAVAILABLE", formattedMessage: msg };
  }

  if (/\[DISK_FULL\]|ENOSPC|No space left on device|Disk quota exceeded/i.test(msg)) {
    return {
      code: "DISK_FULL",
      formattedMessage: `[DISK_FULL] Server temporary disk space is full. Large videos (1-2 GB+) need at least 2x their size during download/merge; attach a Render Persistent Disk with VIDEO_STORE_DIR or wait for active uploads to finish. (${msg.slice(-180)})`,
    };
  }

  if (/ProxyError|Unable to connect to proxy|407 Proxy Authentication|SOCKS|proxyconnect/i.test(msg)) {
    return {
      code: "PROXY_ERROR",
      formattedMessage: `[PROXY_ERROR] Download proxy connection or authentication failed${context?.proxyMaskedHost ? ` (${context.proxyMaskedHost})` : ""}. Check or remove your proxy URL in Settings. (${msg.slice(-220)})`,
    };
  }

  if (/429|Too Many Requests/i.test(msg)) {
    return {
      code: "RATE_LIMITED_429",
      formattedMessage: `[RATE_LIMITED_429] YouTube returned HTTP 429 (Too Many Requests) for this server IP. Wait a few minutes before retrying, or configure a residential proxy in Settings. (${msg.slice(-220)})`,
    };
  }

  if (/Sign in to confirm you.?re not a bot|cookies are no longer valid|confirm you are not a bot|do-i-pass-cookies-to-yt-dlp|exporting-youtube-cookies/i.test(msg)) {
    if (context?.usedCookies) {
      return {
        code: "COOKIES_EXPIRED",
        formattedMessage: `[COOKIES_EXPIRED] YouTube triggered a bot check even with saved cookies (session may be expired or flagged on this IP). Re-export fresh Netscape cookies from a signed-in browser in Settings, and consider adding a proxy. (${msg.slice(-220)})`,
      };
    }
    return {
      code: "BOT_CHECK",
      formattedMessage: `[BOT_CHECK] YouTube requested bot verification. Upload signed-in Netscape cookies in Settings and verify the PO Token server / optional proxy. (${msg.slice(-220)})`,
    };
  }

  if (/Requested format is not available|Only images are available for download/i.test(msg)) {
    if (context?.quality === "4k") {
      return {
        code: "4K_UNAVAILABLE",
        formattedMessage: `[4K_UNAVAILABLE] Strict 4K (2160p) stream is not available for this video from the current server IP/session. Verify cookies + PO Token / proxy in Settings or verify the source video has a native 2160p stream. (${msg.slice(-220)})`,
      };
    }
    return {
      code: "FORMAT_UNAVAILABLE",
      formattedMessage: `[FORMAT_UNAVAILABLE] Requested video quality (${context?.quality ?? "standard"}) is unavailable on YouTube for this client/session. (${msg.slice(-220)})`,
    };
  }

  if (/pot provider|PO Token/i.test(msg)) {
    return {
      code: "POT_UNAVAILABLE",
      formattedMessage: `[POT_UNAVAILABLE] PO Token provider failed to generate a token for YouTube. (${msg.slice(-220)})`,
    };
  }

  if (/stalled|timed out|TransportError/i.test(msg)) {
    if (context?.usedProxy) {
      return {
        code: "PROXY_ERROR",
        formattedMessage: `[PROXY_ERROR] Connection to YouTube timed out via your configured proxy${context.proxyMaskedHost ? ` (${context.proxyMaskedHost})` : ""}. Test or remove the slow/offline proxy in Settings and retry. (${msg.slice(-200)})`,
      };
    }
    const isApiTimeout = /Unable to download API page|TransportError/i.test(msg);
    const qualLabel = context?.quality ? context.quality : "standard";
    return {
      code: "STREAM_STALLED",
      formattedMessage: isApiTimeout
        ? `[STREAM_STALLED] YouTube API connection timed out (${qualLabel}). Check Settings → Test Download Setup or try a working proxy/cookies. (${msg.slice(-200)})`
        : `[STREAM_STALLED] YouTube download stalled or timed out on this connection (${qualLabel}). Try again, choose a lower quality, or configure a faster proxy in Settings. (${msg.slice(-200)})`,
    };
  }

  return {
    code: "YTDLP_ERROR",
    formattedMessage: `[YTDLP_ERROR] ${msg.slice(0, 340)}`,
  };
}
