import { existsSync, mkdirSync, writeFileSync, unlinkSync, statfsSync } from "fs";
import * as os from "os";
import * as path from "path";
import * as net from "net";
import { eq } from "drizzle-orm";
import { db, appConfigTable } from "@workspace/db";
import { logger } from "./logger";

export const YT_COOKIES_DB_KEY = "yt_cookies";
export const YT_PROXY_DB_KEY = "YTDLP_PROXY_URL";
export const YT_PROXY_AUTOPRUNE_DB_KEY = "yt_proxy_autoprune";
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
export const JS_RUNTIME_ARGS = [
  "--js-runtimes", `node:${NODE_BIN}`,
  "--remote-components", "ejs:github",
];
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
const MAX_PROXIES_IN_POOL = 100;

function isPrivateOrLoopbackHost(hostname: string): boolean {
  let host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return true;
  if (host.startsWith("::ffff:")) {
    const tail = host.slice("::ffff:".length);
    const hexMatch = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMatch) {
      const hi = parseInt(hexMatch[1], 16);
      const lo = parseInt(hexMatch[2], 16);
      host = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    } else {
      host = tail;
    }
  }
  if (
    host === "localhost" ||
    host === "::1" ||
    host === "::" ||
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
    if (host === "::1" || host === "::" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) {
      return true;
    }
  }
  return false;
}

export function maskProxyUrl(raw: string): string {
  try {
    const candidate = raw.includes("://") ? raw : `http://${raw}`;
    const parsed = new URL(candidate);
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
    return { ok: false, error: "Proxy entry is empty." };
  }
  if (/[\r\n\s]/.test(trimmed)) {
    return { ok: false, error: "Proxy entry cannot contain spaces or newlines." };
  }

  // Free proxy lists commonly use bare ip:port (or user:pass@ip:port); default bare entries to http://
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return {
      ok: false,
      error: "Invalid proxy format. Expected ip:port or http://ip:port (or socks5://host:port).",
    };
  }

  if (!ALLOWED_PROXY_PROTOCOLS.has(parsed.protocol)) {
    return {
      ok: false,
      error: `Unsupported proxy scheme "${parsed.protocol}". Use ip:port, http://, https://, socks5://, or socks4://.`,
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
      error: "Proxy entry must include a port number (e.g., 1.2.3.4:8080).",
    };
  }

  const portNum = Number(parsed.port);
  if (Number.isNaN(portNum) || portNum < 1 || portNum > 65535) {
    return { ok: false, error: "Proxy port must be between 1 and 65535." };
  }

  const normalized = parsed.toString().replace(/\/+$/, "");
  return {
    ok: true,
    normalized,
    masked: maskProxyUrl(normalized),
  };
}

export function parseAndValidateProxyList(
  raw: string
):
  | { ok: true; proxies: string[]; maskedList: string[]; summary: string }
  | { ok: false; error: string } {
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, error: "Proxy list is empty. Enter one or more ip:port proxies." };
  }

  const rawTokens: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const cleanedLine = line.trim();
    if (!cleanedLine || cleanedLine.startsWith("#")) continue;
    for (const part of cleanedLine.split(/[,;\s]+/)) {
      const token = part.trim();
      if (token) rawTokens.push(token);
    }
  }

  if (rawTokens.length === 0) {
    return { ok: false, error: "Proxy list is empty. Enter one or more ip:port proxies." };
  }

  if (rawTokens.length > MAX_PROXIES_IN_POOL) {
    return {
      ok: false,
      error: `Too many proxies (${rawTokens.length}). Maximum allowed in the pool is ${MAX_PROXIES_IN_POOL}.`,
    };
  }

  const proxies: string[] = [];
  const maskedList: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < rawTokens.length; i++) {
    const token = rawTokens[i];
    const check = validateAndNormalizeProxyUrl(token);
    if (!check.ok) {
      const label = rawTokens.length > 1 ? `Proxy #${i + 1} (${maskProxyUrl(token)}): ` : "";
      return { ok: false, error: `${label}${check.error}` };
    }
    if (!seen.has(check.normalized)) {
      seen.add(check.normalized);
      proxies.push(check.normalized);
      maskedList.push(check.masked);
    }
  }

  const summary =
    maskedList.length === 1
      ? maskedList[0]
      : `${maskedList[0]} (+${maskedList.length - 1} more)`;

  return { ok: true, proxies, maskedList, summary };
}

export function getPublicTemplateEntry(raw: string): string | null {
  try {
    const candidate = raw.includes("://") ? raw : `http://${raw}`;
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" || parsed.username || parsed.password || !parsed.port) {
      return null;
    }
    return `${parsed.hostname}:${parsed.port}`;
  } catch {
    return null;
  }
}

export async function getProxyAutoPruneEnabled(): Promise<boolean> {
  try {
    const [row] = await db
      .select({ value: appConfigTable.value })
      .from(appConfigTable)
      .where(eq(appConfigTable.key, YT_PROXY_AUTOPRUNE_DB_KEY))
      .limit(1);
    return row?.value === "true";
  } catch {
    return false;
  }
}

export async function setProxyAutoPruneEnabled(enabled: boolean): Promise<void> {
  const value = enabled ? "true" : "false";
  await db
    .insert(appConfigTable)
    .values({ key: YT_PROXY_AUTOPRUNE_DB_KEY, value })
    .onConflictDoUpdate({
      target: appConfigTable.key,
      set: { value, updatedAt: new Date() },
    });
}

export async function saveStoredProxyList(proxies: string[]): Promise<void> {
  if (proxies.length === 0) {
    await db.delete(appConfigTable).where(eq(appConfigTable.key, YT_PROXY_DB_KEY));
    return;
  }
  const storedValue = proxies.join("\n");
  await db
    .insert(appConfigTable)
    .values({ key: YT_PROXY_DB_KEY, value: storedValue })
    .onConflictDoUpdate({
      target: appConfigTable.key,
      set: { value: storedValue, updatedAt: new Date() },
    });
}

export async function removeProxyFromStoredPool(
  target: string | { index?: number; maskedHost?: string }
): Promise<{ removed: boolean; remainingCount: number }> {
  const current = await getStoredProxyList();
  if (current.length === 0) {
    return { removed: false, remainingCount: 0 };
  }

  let next: string[];
  if (typeof target === "object") {
    if (typeof target.index === "number" && target.index >= 0 && target.index < current.length) {
      next = current.filter((_, i) => i !== target.index);
    } else if (target.maskedHost) {
      const idx = current.findIndex((p) => maskProxyUrl(p) === target.maskedHost);
      next = idx >= 0 ? current.filter((_, i) => i !== idx) : current;
    } else {
      next = current;
    }
  } else {
    const normalizedTarget = target.trim().replace(/\/+$/, "");
    next = current.filter(
      (p) => p !== normalizedTarget && maskProxyUrl(p) !== normalizedTarget
    );
  }

  if (next.length === current.length) {
    return { removed: false, remainingCount: current.length };
  }

  await saveStoredProxyList(next);
  return { removed: true, remainingCount: next.length };
}

export async function getStoredProxyList(): Promise<string[]> {
  try {
    const [row] = await db
      .select({ value: appConfigTable.value })
      .from(appConfigTable)
      .where(eq(appConfigTable.key, YT_PROXY_DB_KEY))
      .limit(1);
    const val = row?.value?.trim();
    if (!val) return [];
    const parsed = parseAndValidateProxyList(val);
    return parsed.ok ? parsed.proxies : [];
  } catch {
    return [];
  }
}

export async function getStoredProxyUrl(): Promise<string | null> {
  const list = await getStoredProxyList();
  return list[0] ?? null;
}

export async function getMaskedProxyStatus(): Promise<{
  set: boolean;
  count: number;
  maskedHost: string | null;
  maskedProxies: string[];
  autoPrune: boolean;
  updatedAt: string | null;
}> {
  const [[row], autoPrune] = await Promise.all([
    db
      .select({ value: appConfigTable.value, updatedAt: appConfigTable.updatedAt })
      .from(appConfigTable)
      .where(eq(appConfigTable.key, YT_PROXY_DB_KEY))
      .limit(1),
    getProxyAutoPruneEnabled(),
  ]);

  if (!row?.value) {
    return {
      set: false,
      count: 0,
      maskedHost: null,
      maskedProxies: [],
      autoPrune,
      updatedAt: null,
    };
  }

  const parsed = parseAndValidateProxyList(row.value);
  if (!parsed.ok) {
    const fallback = maskProxyUrl(row.value);
    return {
      set: true,
      count: 1,
      maskedHost: fallback,
      maskedProxies: [fallback],
      autoPrune,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  return {
    set: true,
    count: parsed.proxies.length,
    maskedHost: parsed.summary,
    maskedProxies: parsed.maskedList,
    autoPrune,
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
      const proxyNote = context.usedProxy
        ? ` Note: your configured proxy${context.proxyMaskedHost ? ` (${context.proxyMaskedHost})` : ""} may also be flagged by YouTube — try removing or changing the proxy in Settings if fresh cookies still fail.`
        : " Consider adding a clean residential proxy in Settings if the server IP is flagged.";
      return {
        code: "COOKIES_EXPIRED",
        formattedMessage: `[COOKIES_EXPIRED] YouTube triggered a bot check even with saved cookies (session may be expired or flagged on this IP). Re-export fresh Netscape cookies from a signed-in browser in Settings.${proxyNote} (${msg.slice(-220)})`,
      };
    }
    return {
      code: "BOT_CHECK",
      formattedMessage: `[BOT_CHECK] YouTube requested bot verification. Upload signed-in Netscape cookies in Settings and verify the PO Token server / optional proxy. (${msg.slice(-220)})`,
    };
  }

  if (/n challenge solving failed|Signature solving failed|yt-dlp-ejs/i.test(msg)) {
    return {
      code: "FORMAT_UNAVAILABLE",
      formattedMessage: `[FORMAT_UNAVAILABLE] YouTube JS challenge solver (EJS) failed to decode stream URLs. Ensure Node runtime, yt-dlp-ejs, or --remote-components ejs:github can run and redeploy/retry. (${msg.slice(-220)})`,
    };
  }

  if (/Requested format is not available|Only images are available for download|No video formats found|SABR-only/i.test(msg)) {
    if (context?.quality === "4k") {
      return {
        code: "4K_UNAVAILABLE",
        formattedMessage: `[4K_UNAVAILABLE] Strict 4K (2160p) stream is not available for this video from the current server IP/session. Verify cookies + PO Token / proxy in Settings or verify the source video has a native 2160p stream. (${msg.slice(-220)})`,
      };
    }
    const proxyHint = context?.usedProxy
      ? ` Try removing or changing your proxy${context.proxyMaskedHost ? ` (${context.proxyMaskedHost})` : ""}, or re-exporting cookies.`
      : " Re-export fresh Netscape cookies in Settings or check PO Token / proxy.";
    return {
      code: "FORMAT_UNAVAILABLE",
      formattedMessage: `[FORMAT_UNAVAILABLE] YouTube returned no playable video formats (${context?.quality ?? "standard"}) for this client/session.${proxyHint} (${msg.slice(-200)})`,
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
