import * as crypto from "crypto";
import { eq } from "drizzle-orm";
import { db, appConfigTable } from "@workspace/db";
import { logger } from "./logger";
import {
  maskProxyUrl,
  saveStoredProxyList,
  validateAndNormalizeProxyUrl,
} from "./ytdlp-config";
import { checkProxyReachability } from "./ytdlp-downloader";

export const PROXY_SCRAPER_CONFIG_DB_KEY = "proxy_scraper_config";
export const PROXY_SCRAPER_TOKEN_HASH_DB_KEY = "proxy_scraper_token_hash";
export const PROXY_SCRAPER_LAST_RUN_DB_KEY = "proxy_scraper_last_run";

export const MAX_WORKING_PROXIES_TO_KEEP = 30;
export const MAX_CANDIDATES_TO_TEST = 240;
export const MAX_CUSTOM_FEEDS = 10;
const FEED_FETCH_TIMEOUT_MS = 8_000;
const FEED_MAX_BYTES = 2 * 1024 * 1024;
const SCRAPE_COOLDOWN_MS = 15_000;

export type ProxyFeedProtocol = "http" | "socks4" | "socks5";

export interface BuiltinProxyFeed {
  id: string;
  label: string;
  protocol: ProxyFeedProtocol;
  url: string;
  defaultEnabled: boolean;
}

export const BUILTIN_GITHUB_PROXY_FEEDS: readonly BuiltinProxyFeed[] = [
  {
    id: "monosans_http",
    label: "monosans / HTTP",
    protocol: "http",
    url: "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
    defaultEnabled: true,
  },
  {
    id: "monosans_socks5",
    label: "monosans / SOCKS5",
    protocol: "socks5",
    url: "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt",
    defaultEnabled: true,
  },
  {
    id: "speedx_http",
    label: "TheSpeedX / HTTP",
    protocol: "http",
    url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
    defaultEnabled: true,
  },
  {
    id: "speedx_socks5",
    label: "TheSpeedX / SOCKS5",
    protocol: "socks5",
    url: "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks5.txt",
    defaultEnabled: true,
  },
  {
    id: "speedx_socks4",
    label: "TheSpeedX / SOCKS4",
    protocol: "socks4",
    url: "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks4.txt",
    defaultEnabled: false,
  },
  {
    id: "proxifly_http",
    label: "proxifly / HTTP",
    protocol: "http",
    url: "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/http/data.txt",
    defaultEnabled: true,
  },
  {
    id: "proxifly_socks5",
    label: "proxifly / SOCKS5",
    protocol: "socks5",
    url: "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/socks5/data.txt",
    defaultEnabled: false,
  },
] as const;

const BUILTIN_FEED_MAP = new Map<string, BuiltinProxyFeed>(
  BUILTIN_GITHUB_PROXY_FEEDS.map((f) => [f.id, f])
);

const ALLOWED_GITHUB_RAW_HOSTS = new Set([
  "raw.githubusercontent.com",
  "gist.githubusercontent.com",
]);

export interface ProxyScraperConfig {
  enabledFeedIds: string[];
  customUrls: string[];
}

export interface ScrapeSourceSummary {
  id: string;
  label: string;
  protocol: ProxyFeedProtocol;
  ok: boolean;
  parsedCount: number;
  error: string | null;
}

export interface ProxyScraperRunReport {
  ok: boolean;
  triggeredBy: "api_token" | "settings_ui";
  ranAt: string;
  durationMs: number;
  poolReplaced: boolean;
  scrapedTotal: number;
  testedCount: number;
  workingFound: number;
  savedCount: number;
  fastestMs: number | null;
  topProxies: Array<{ maskedHost: string; latencyMs: number | null }>;
  sources: ScrapeSourceSummary[];
  message: string;
}

export function getDefaultScraperConfig(): ProxyScraperConfig {
  return {
    enabledFeedIds: BUILTIN_GITHUB_PROXY_FEEDS.filter((f) => f.defaultEnabled).map((f) => f.id),
    customUrls: [],
  };
}

export function validateCustomGithubFeedUrl(
  rawUrl: string
): { ok: true; normalized: string } | { ok: false; error: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { ok: false, error: "Feed URL is empty." };
  }
  if (/[\r\n\s]/.test(trimmed)) {
    return { ok: false, error: "Feed URL cannot contain spaces or newlines." };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: `Invalid URL: ${trimmed.slice(0, 80)}` };
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, error: "Custom GitHub proxy feed URLs must use https://." };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "Feed URL cannot include embedded credentials." };
  }
  if (parsed.port) {
    return { ok: false, error: "Feed URL cannot specify a custom port." };
  }

  // Convenience normalization for standard github.com/.../blob/... links
  let host = parsed.hostname.toLowerCase();
  let pathname = parsed.pathname;
  if (host === "github.com") {
    const blobMatch = pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
    if (!blobMatch) {
      return {
        ok: false,
        error: "Use a raw.githubusercontent.com or gist.githubusercontent.com URL (or a github.com/.../blob/... link).",
      };
    }
    host = "raw.githubusercontent.com";
    pathname = `/${blobMatch[1]}/${blobMatch[2]}/${blobMatch[3]}`;
  }

  if (!ALLOWED_GITHUB_RAW_HOSTS.has(host)) {
    return {
      ok: false,
      error: "Only raw.githubusercontent.com or gist.githubusercontent.com feed URLs are allowed.",
    };
  }

  const cleanSegments = pathname.split("/").filter(Boolean);
  if (cleanSegments.length < 3) {
    return { ok: false, error: "GitHub raw URL path looks incomplete." };
  }

  const normalized = `https://${host}${pathname}${parsed.search}`;
  return { ok: true, normalized };
}

export function validateScraperConfigInput(input: {
  enabledFeedIds?: unknown;
  customUrls?: unknown;
}): { ok: true; config: ProxyScraperConfig } | { ok: false; error: string } {
  const enabledFeedIds: string[] = [];
  if (Array.isArray(input.enabledFeedIds)) {
    const seen = new Set<string>();
    for (const rawId of input.enabledFeedIds) {
      if (typeof rawId !== "string") continue;
      const id = rawId.trim();
      if (BUILTIN_FEED_MAP.has(id) && !seen.has(id)) {
        seen.add(id);
        enabledFeedIds.push(id);
      }
    }
  }

  const customUrls: string[] = [];
  const rawCustomList: string[] = Array.isArray(input.customUrls)
    ? input.customUrls.filter((u): u is string => typeof u === "string")
    : typeof input.customUrls === "string"
      ? input.customUrls.split(/\r?\n/)
      : [];

  const seenUrls = new Set<string>();
  for (const rawLine of rawCustomList) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const check = validateCustomGithubFeedUrl(trimmed);
    if (!check.ok) {
      return { ok: false, error: check.error };
    }
    if (!seenUrls.has(check.normalized)) {
      seenUrls.add(check.normalized);
      customUrls.push(check.normalized);
    }
  }

  if (customUrls.length > MAX_CUSTOM_FEEDS) {
    return {
      ok: false,
      error: `Too many custom feed URLs (${customUrls.length}). Maximum allowed is ${MAX_CUSTOM_FEEDS}.`,
    };
  }

  if (enabledFeedIds.length === 0 && customUrls.length === 0) {
    return {
      ok: false,
      error: "Enable at least one built-in GitHub feed or add a custom GitHub raw URL.",
    };
  }

  return { ok: true, config: { enabledFeedIds, customUrls } };
}

export function extractProxiesFromFeedText(
  rawText: string,
  defaultProtocol: ProxyFeedProtocol = "http"
): string[] {
  const results: string[] = [];
  const seen = new Set<string>();

  for (const line of rawText.split(/\r?\n/)) {
    const withoutComment = line.replace(/\s+#.*$/, "").trim();
    if (!withoutComment || withoutComment.startsWith("#") || withoutComment.startsWith("//")) {
      continue;
    }

    for (const token of withoutComment.split(/[,;\s]+/)) {
      const cleaned = token.trim();
      if (!cleaned) continue;
      const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(cleaned)
        ? cleaned
        : `${defaultProtocol}://${cleaned}`;

      const check = validateAndNormalizeProxyUrl(candidate);
      if (check.ok && !seen.has(check.normalized)) {
        seen.add(check.normalized);
        results.push(check.normalized);
      }
    }
  }

  return results;
}

export function sampleCandidatesRoundRobin(
  sourceBuckets: string[][],
  maxCandidates = MAX_CANDIDATES_TO_TEST
): string[] {
  const shuffledBuckets = sourceBuckets.map((bucket) => {
    const copy = [...bucket];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  });

  const selected: string[] = [];
  const seen = new Set<string>();
  let depth = 0;

  while (selected.length < maxCandidates) {
    let addedInPass = false;
    for (const bucket of shuffledBuckets) {
      if (depth < bucket.length) {
        const proxy = bucket[depth];
        if (!seen.has(proxy)) {
          seen.add(proxy);
          selected.push(proxy);
          if (selected.length >= maxCandidates) break;
        }
        addedInPass = true;
      }
    }
    if (!addedInPass) break;
    depth++;
  }

  return selected;
}

export function selectTopWorkingProxies<T extends { proxy: string; ok: boolean; latencyMs: number | null }>(
  checked: T[],
  limit = MAX_WORKING_PROXIES_TO_KEEP
): Array<T & { maskedHost: string }> {
  return checked
    .filter((item) => item.ok)
    .sort((a, b) => (a.latencyMs ?? 99_999) - (b.latencyMs ?? 99_999))
    .slice(0, limit)
    .map((item) => ({
      ...item,
      maskedHost: maskProxyUrl(item.proxy),
    }));
}

// ── Secret Trigger Token Hashing & Verification ──────────────────────────────

export function hashTriggerToken(plaintext: string, saltHex?: string): string {
  const salt = saltHex ?? crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(plaintext, salt, 32).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyTriggerToken(plaintext: string, storedHash: string): boolean {
  if (!plaintext || !storedHash) return false;
  const parts = storedHash.split(":");
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  if (!salt || !expectedHex || !/^[0-9a-f]+$/i.test(expectedHex)) return false;

  try {
    const expectedBuf = Buffer.from(expectedHex, "hex");
    const actualBuf = crypto.scryptSync(plaintext, salt, expectedBuf.length);
    if (actualBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(actualBuf, expectedBuf);
  } catch {
    return false;
  }
}

export async function getStoredScraperConfig(): Promise<ProxyScraperConfig> {
  try {
    const [row] = await db
      .select({ value: appConfigTable.value })
      .from(appConfigTable)
      .where(eq(appConfigTable.key, PROXY_SCRAPER_CONFIG_DB_KEY))
      .limit(1);

    if (!row?.value) return getDefaultScraperConfig();
    const parsed = JSON.parse(row.value) as { enabledFeedIds?: unknown; customUrls?: unknown };
    const validated = validateScraperConfigInput(parsed);
    return validated.ok ? validated.config : getDefaultScraperConfig();
  } catch {
    return getDefaultScraperConfig();
  }
}

export async function saveStoredScraperConfig(config: ProxyScraperConfig): Promise<void> {
  const value = JSON.stringify(config);
  await db
    .insert(appConfigTable)
    .values({ key: PROXY_SCRAPER_CONFIG_DB_KEY, value })
    .onConflictDoUpdate({
      target: appConfigTable.key,
      set: { value, updatedAt: new Date() },
    });
}

export async function getScraperTokenStatus(): Promise<{
  configured: boolean;
  updatedAt: string | null;
}> {
  try {
    const [row] = await db
      .select({ value: appConfigTable.value, updatedAt: appConfigTable.updatedAt })
      .from(appConfigTable)
      .where(eq(appConfigTable.key, PROXY_SCRAPER_TOKEN_HASH_DB_KEY))
      .limit(1);
    return {
      configured: Boolean(row?.value),
      updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
    };
  } catch {
    return { configured: false, updatedAt: null };
  }
}

export async function rotateScraperTriggerToken(): Promise<{
  token: string;
  updatedAt: string;
}> {
  const token = `nxpx_${crypto.randomBytes(24).toString("base64url")}`;
  const hashed = hashTriggerToken(token);
  const now = new Date();
  await db
    .insert(appConfigTable)
    .values({ key: PROXY_SCRAPER_TOKEN_HASH_DB_KEY, value: hashed, updatedAt: now })
    .onConflictDoUpdate({
      target: appConfigTable.key,
      set: { value: hashed, updatedAt: now },
    });
  return { token, updatedAt: now.toISOString() };
}

export async function revokeScraperTriggerToken(): Promise<void> {
  await db
    .delete(appConfigTable)
    .where(eq(appConfigTable.key, PROXY_SCRAPER_TOKEN_HASH_DB_KEY));
}

export async function verifyStoredScraperTriggerToken(candidate: string): Promise<boolean> {
  if (!candidate || candidate.length < 16 || candidate.length > 256) return false;
  try {
    const [row] = await db
      .select({ value: appConfigTable.value })
      .from(appConfigTable)
      .where(eq(appConfigTable.key, PROXY_SCRAPER_TOKEN_HASH_DB_KEY))
      .limit(1);
    if (!row?.value) return false;
    return verifyTriggerToken(candidate, row.value);
  } catch {
    return false;
  }
}

export async function getLastScrapeReport(): Promise<ProxyScraperRunReport | null> {
  try {
    const [row] = await db
      .select({ value: appConfigTable.value })
      .from(appConfigTable)
      .where(eq(appConfigTable.key, PROXY_SCRAPER_LAST_RUN_DB_KEY))
      .limit(1);
    if (!row?.value) return null;
    return JSON.parse(row.value) as ProxyScraperRunReport;
  } catch {
    return null;
  }
}

async function saveLastScrapeReport(report: ProxyScraperRunReport): Promise<void> {
  const value = JSON.stringify(report);
  await db
    .insert(appConfigTable)
    .values({ key: PROXY_SCRAPER_LAST_RUN_DB_KEY, value })
    .onConflictDoUpdate({
      target: appConfigTable.key,
      set: { value, updatedAt: new Date() },
    });
}

// ── Feed Fetcher & Single-Flight Scraper Runner ──────────────────────────────

async function fetchBoundedFeedText(feedUrl: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(feedUrl, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: {
        Accept: "text/plain, */*;q=0.5",
        "User-Agent": "N3XUS-ProxySync/1.0",
      },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const contentLength = Number(res.headers.get("content-length") || "0");
    if (contentLength > FEED_MAX_BYTES) {
      throw new Error("Feed exceeds 2 MB limit");
    }

    const text = await res.text();
    if (text.length > FEED_MAX_BYTES) {
      return text.slice(0, FEED_MAX_BYTES);
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function inferProtocolFromUrl(feedUrl: string): ProxyFeedProtocol {
  const lower = feedUrl.toLowerCase();
  if (lower.includes("socks5")) return "socks5";
  if (lower.includes("socks4")) return "socks4";
  return "http";
}

let scrapeInProgress = false;
let lastCompletedAtMs = 0;

export function isProxyScrapeRunning(): boolean {
  return scrapeInProgress;
}

export class ScrapeConflictError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function runGithubProxyScrape(options: {
  triggeredBy: "api_token" | "settings_ui";
}): Promise<ProxyScraperRunReport> {
  if (scrapeInProgress) {
    throw new ScrapeConflictError(
      "A GitHub proxy scrape is already running. Wait a moment and try again.",
      409
    );
  }

  const now = Date.now();
  if (options.triggeredBy === "api_token" && now - lastCompletedAtMs < SCRAPE_COOLDOWN_MS) {
    const waitSecs = Math.ceil((SCRAPE_COOLDOWN_MS - (now - lastCompletedAtMs)) / 1000);
    throw new ScrapeConflictError(
      `Scraper cooldown active. Wait ${waitSecs}s before triggering another run.`,
      429
    );
  }

  scrapeInProgress = true;
  const startedAt = Date.now();

  try {
    const config = await getStoredScraperConfig();

    const activeFeeds: Array<{
      id: string;
      label: string;
      protocol: ProxyFeedProtocol;
      url: string;
    }> = [];

    for (const feedId of config.enabledFeedIds) {
      const feed = BUILTIN_FEED_MAP.get(feedId);
      if (feed) {
        activeFeeds.push({
          id: feed.id,
          label: feed.label,
          protocol: feed.protocol,
          url: feed.url,
        });
      }
    }

    config.customUrls.forEach((url, index) => {
      let label = `Custom #${index + 1}`;
      try {
        const u = new URL(url);
        const parts = u.pathname.split("/").filter(Boolean);
        label = parts.length >= 2 ? `Custom (${parts[0]}/${parts[1]})` : `Custom (${u.hostname})`;
      } catch {
        // ignore
      }
      activeFeeds.push({
        id: `custom_${index + 1}`,
        label,
        protocol: inferProtocolFromUrl(url),
        url,
      });
    });

    const sourceBuckets: string[][] = [];
    const sourceSummaries: ScrapeSourceSummary[] = [];
    const totalDedupedSet = new Set<string>();

    const fetchResults = await Promise.all(
      activeFeeds.map(async (feed) => {
        try {
          const text = await fetchBoundedFeedText(feed.url);
          const parsed = extractProxiesFromFeedText(text, feed.protocol);
          return { feed, ok: true as const, parsed, error: null };
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Fetch failed";
          return { feed, ok: false as const, parsed: [] as string[], error: msg };
        }
      })
    );

    for (const item of fetchResults) {
      for (const p of item.parsed) totalDedupedSet.add(p);
      if (item.parsed.length > 0) {
        sourceBuckets.push(item.parsed);
      }
      sourceSummaries.push({
        id: item.feed.id,
        label: item.feed.label,
        protocol: item.feed.protocol,
        ok: item.ok,
        parsedCount: item.parsed.length,
        error: item.error,
      });
    }

    const candidates = sampleCandidatesRoundRobin(sourceBuckets, MAX_CANDIDATES_TO_TEST);

    const checked: Array<{ proxy: string; ok: boolean; latencyMs: number | null }> = [];
    const batchSize = 24;
    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (proxy) => {
          const res = await checkProxyReachability(proxy, 3000);
          return { proxy, ok: res.ok, latencyMs: res.latencyMs };
        })
      );
      checked.push(...batchResults);
    }

    const allWorkingCount = checked.filter((c) => c.ok).length;
    const topWorking = selectTopWorkingProxies(checked, MAX_WORKING_PROXIES_TO_KEEP);

    let poolReplaced = false;
    if (topWorking.length > 0) {
      await saveStoredProxyList(topWorking.map((p) => p.proxy));
      poolReplaced = true;
    }

    const fastestMs = topWorking[0]?.latencyMs ?? null;
    const durationMs = Date.now() - startedAt;

    const message =
      topWorking.length > 0
        ? `Replaced pool with top ${topWorking.length} fastest working proxies (${allWorkingCount} working out of ${candidates.length} tested).`
        : candidates.length === 0
          ? "No proxy entries could be fetched from the selected GitHub sources. Existing pool was kept intact."
          : `Tested ${candidates.length} scraped proxies but none passed live tunnel checks. Existing pool was kept intact.`;

    const report: ProxyScraperRunReport = {
      ok: topWorking.length > 0,
      triggeredBy: options.triggeredBy,
      ranAt: new Date().toISOString(),
      durationMs,
      poolReplaced,
      scrapedTotal: totalDedupedSet.size,
      testedCount: candidates.length,
      workingFound: allWorkingCount,
      savedCount: topWorking.length,
      fastestMs,
      topProxies: topWorking.map((p) => ({
        maskedHost: p.maskedHost,
        latencyMs: p.latencyMs,
      })),
      sources: sourceSummaries,
      message,
    };

    await saveLastScrapeReport(report);
    lastCompletedAtMs = Date.now();
    logger.info(
      {
        triggeredBy: options.triggeredBy,
        scrapedTotal: report.scrapedTotal,
        testedCount: report.testedCount,
        workingFound: report.workingFound,
        savedCount: report.savedCount,
        durationMs,
      },
      "GitHub proxy scrape completed"
    );
    return report;
  } finally {
    scrapeInProgress = false;
  }
}
