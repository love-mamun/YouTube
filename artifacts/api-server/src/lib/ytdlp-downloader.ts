import { spawn, execFile } from "child_process";
import { promisify } from "util";
import { existsSync, unlinkSync, statSync, readdirSync } from "fs";
import * as path from "path";
import * as net from "net";
import { logger } from "./logger";
import {
  YTDLP_ENV,
  JS_RUNTIME_ARGS,
  CHROME_UA,
  acquireJobCookieCopy,
  getStoredProxyList,
  getProxyAutoPruneEnabled,
  removeProxyFromStoredPool,
  getPublicTemplateEntry,
  detectPotProvider,
  classifyYtDlpError,
  maskProxyUrl,
  getVideoStoreDir,
  getDiskSpaceInfo,
  type DiskSpaceInfo,
  type YtDlpErrorCode,
} from "./ytdlp-config";

const execFileAsync = promisify(execFile);

export interface YtDlpMeta {
  title?: string;
  description?: string;
  tags?: string[];
  duration?: number;
  thumbnail?: string;
  uploader?: string;
  view_count?: number;
  id?: string;
  extractor?: string;
  webpage_url?: string;
}

interface ClientStrategy {
  client: string;
  useCookies: boolean;
  usePot: boolean;
  useMissingPotFlag: boolean;
}

const HEIGHT_MAP: Record<string, number> = {
  "360p": 360,
  "480p": 480,
  "720p": 720,
  "1080p": 1080,
  "1440p": 1440,
  "4k": 2160,
};

const VCODEC_MAP: Record<string, string> = {
  av1: "av01",
  vp9: "vp9",
  h264: "avc1",
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new Error("Stopped by user"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Stopped by user"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

let proxyRotationCursor = 0;

function rotateProxyPool<T>(list: T[]): T[] {
  if (list.length <= 1) return [...list];
  const offset = proxyRotationCursor % list.length;
  proxyRotationCursor = (proxyRotationCursor + 1) % 1_000_000;
  return [...list.slice(offset), ...list.slice(0, offset)];
}

export interface ProxyHealthEntry {
  failCount: number;
  lastLatencyMs: number | null;
  cooldownUntil: number;
}

const proxyHealthMap = new Map<string, ProxyHealthEntry>();
const PROXY_COOLDOWN_MS = 180_000;

export function recordProxySuccess(proxyUrl: string, latencyMs: number | null): void {
  const prev = proxyHealthMap.get(proxyUrl);
  proxyHealthMap.set(proxyUrl, {
    failCount: 0,
    lastLatencyMs: latencyMs ?? prev?.lastLatencyMs ?? null,
    cooldownUntil: 0,
  });
}

export function recordProxyFailure(proxyUrl: string, now = Date.now()): ProxyHealthEntry {
  const prev = proxyHealthMap.get(proxyUrl);
  const failCount = (prev?.failCount ?? 0) + 1;
  const entry: ProxyHealthEntry = {
    failCount,
    lastLatencyMs: prev?.lastLatencyMs ?? null,
    cooldownUntil: now + PROXY_COOLDOWN_MS,
  };
  proxyHealthMap.set(proxyUrl, entry);
  return entry;
}

export function rankAndFilterHealthyProxies(
  proxies: string[],
  healthMap: Map<string, ProxyHealthEntry> = proxyHealthMap,
  now = Date.now()
): string[] {
  if (proxies.length <= 1) return [...proxies];
  const healthy: string[] = [];
  const coolingDown: string[] = [];
  for (const p of proxies) {
    const h = healthMap.get(p);
    if (h && h.cooldownUntil > now) {
      coolingDown.push(p);
    } else {
      healthy.push(p);
    }
  }
  const sortByLatency = (a: string, b: string) => {
    const la = healthMap.get(a)?.lastLatencyMs ?? Number.MAX_SAFE_INTEGER;
    const lb = healthMap.get(b)?.lastLatencyMs ?? Number.MAX_SAFE_INTEGER;
    return la - lb;
  };
  healthy.sort(sortByLatency);
  coolingDown.sort((a, b) => (healthMap.get(a)?.failCount ?? 0) - (healthMap.get(b)?.failCount ?? 0));
  return [...healthy, ...coolingDown];
}

export async function checkProxyReachability(
  proxyUrl: string,
  timeoutMs = 3500
): Promise<{ ok: boolean; latencyMs: number | null; error: string | null }> {
  const startedAt = Date.now();
  try {
    const parsed = new URL(proxyUrl);
    const host = parsed.hostname.replace(/^\[|\]$/g, "");
    const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
    if (!host || Number.isNaN(port) || port < 1 || port > 65535) {
      return { ok: false, latencyMs: null, error: "Invalid proxy host or port" };
    }

    const proto = parsed.protocol.toLowerCase();

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let buffer = "";
      const rawChunks: Buffer[] = [];

      const socket = net.createConnection({ host, port });
      const timer = setTimeout(() => {
        done(new Error(`Timed out (${Math.round(timeoutMs / 1000)}s)`));
      }, timeoutMs);

      const done = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          socket.destroy();
        } catch {
          // noop
        }
        if (err) reject(err);
        else resolve();
      };

      socket.on("connect", () => {
        if (proto === "http:" || proto === "https:") {
          const headers = [
            "CONNECT www.youtube.com:443 HTTP/1.1",
            "Host: www.youtube.com:443",
            "Proxy-Connection: keep-alive",
          ];
          if (parsed.username || parsed.password) {
            const creds = `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`;
            headers.push(`Proxy-Authorization: Basic ${Buffer.from(creds).toString("base64")}`);
          }
          headers.push("", "");
          socket.write(headers.join("\r\n"));
          return;
        }
        if (proto === "socks5:" || proto === "socks5h:") {
          const hasCreds = Boolean(parsed.username || parsed.password);
          socket.write(hasCreds ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00]));
          return;
        }
        // socks4 / socks4a: verified TCP connect
        done();
      });

      socket.on("data", (chunk: Buffer) => {
        if (proto === "http:" || proto === "https:") {
          buffer += chunk.toString("latin1");
          const statusLine = buffer.split(/\r?\n/)[0] ?? "";
          if (!statusLine && buffer.length < 16) return;
          const m = statusLine.match(/^HTTP\/\d\.\d\s+(\d{3})/i);
          if (m) {
            const code = parseInt(m[1], 10);
            if (code >= 200 && code < 300) {
              done();
            } else if (code === 407) {
              done(new Error("407 Proxy Authentication Required"));
            } else {
              done(new Error(`Proxy rejected HTTPS tunnel (HTTP ${code})`));
            }
          } else if (buffer.length > 64) {
            done(new Error("Invalid proxy HTTP CONNECT response"));
          }
          return;
        }
        if (proto === "socks5:" || proto === "socks5h:") {
          rawChunks.push(chunk);
          const merged = Buffer.concat(rawChunks);
          if (merged.length >= 2) {
            if (merged[0] !== 0x05) {
              done(new Error("Invalid SOCKS5 proxy handshake"));
            } else if (merged[1] === 0xff) {
              done(new Error("SOCKS5 proxy rejected authentication method"));
            } else {
              done();
            }
          }
        }
      });

      socket.on("end", () => {
        if (!settled) {
          done(new Error("Proxy closed tunnel connection without responding"));
        }
      });

      socket.on("error", (e) => done(e));
    });

    const latencyMs = Math.max(1, Date.now() - startedAt);
    recordProxySuccess(proxyUrl, latencyMs);
    return { ok: true, latencyMs, error: null };
  } catch (err) {
    return {
      ok: false,
      latencyMs: null,
      error: err instanceof Error ? err.message : "Failed to reach proxy host",
    };
  }
}

export interface ProxyPruneItem {
  maskedHost: string;
  templateEntry: string | null;
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
}

export interface ProxyPruneResult {
  total: number;
  workingCount: number;
  removedCount: number;
  workingProxies: string[];
  results: ProxyPruneItem[];
}

export async function pruneAndRankProxyPool(proxyList: string[]): Promise<ProxyPruneResult> {
  if (proxyList.length === 0) {
    return { total: 0, workingCount: 0, removedCount: 0, workingProxies: [], results: [] };
  }

  const batchSize = 15;
  const checked: Array<{
    proxy: string;
    maskedHost: string;
    templateEntry: string | null;
    ok: boolean;
    latencyMs: number | null;
    error: string | null;
  }> = [];

  for (let i = 0; i < proxyList.length; i += batchSize) {
    const batch = proxyList.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (proxy) => {
        const res = await checkProxyReachability(proxy, 3500);
        if (!res.ok) {
          recordProxyFailure(proxy);
        }
        return {
          proxy,
          maskedHost: maskProxyUrl(proxy),
          templateEntry: getPublicTemplateEntry(proxy),
          ok: res.ok,
          latencyMs: res.latencyMs,
          error: res.error,
        };
      })
    );
    checked.push(...batchResults);
  }

  const workingSorted = checked
    .filter((c) => c.ok)
    .sort((a, b) => (a.latencyMs ?? 99999) - (b.latencyMs ?? 99999));
  const dead = checked.filter((c) => !c.ok);

  const combined = [...workingSorted, ...dead];
  return {
    total: proxyList.length,
    workingCount: workingSorted.length,
    removedCount: dead.length,
    workingProxies: workingSorted.map((c) => c.proxy),
    results: combined.map(({ maskedHost, templateEntry, ok, latencyMs, error }) => ({
      maskedHost,
      templateEntry,
      ok,
      latencyMs,
      error,
    })),
  };
}

function buildStrategies(hasCookies: boolean, hasPot: boolean): ClientStrategy[] {
  if (hasPot && hasCookies) {
    return [
      { client: "default", useCookies: true, usePot: true, useMissingPotFlag: false },
      { client: "web", useCookies: true, usePot: true, useMissingPotFlag: false },
      { client: "mweb", useCookies: true, usePot: true, useMissingPotFlag: false },
      { client: "web", useCookies: false, usePot: true, useMissingPotFlag: false },
      { client: "android_vr", useCookies: false, usePot: false, useMissingPotFlag: true },
    ];
  }
  if (hasPot && !hasCookies) {
    return [
      { client: "default", useCookies: false, usePot: true, useMissingPotFlag: false },
      { client: "web", useCookies: false, usePot: true, useMissingPotFlag: false },
      { client: "android_vr", useCookies: false, usePot: false, useMissingPotFlag: true },
      { client: "mweb", useCookies: false, usePot: true, useMissingPotFlag: false },
    ];
  }
  if (!hasPot && hasCookies) {
    // yt-dlp's default client chain handles tv_simply + web_embedded + web automatically
    return [
      { client: "default", useCookies: true, usePot: false, useMissingPotFlag: true },
      { client: "mweb", useCookies: true, usePot: false, useMissingPotFlag: true },
      { client: "web", useCookies: true, usePot: false, useMissingPotFlag: true },
      { client: "android_vr", useCookies: false, usePot: false, useMissingPotFlag: true },
    ];
  }
  return [
    { client: "android_vr", useCookies: false, usePot: false, useMissingPotFlag: true },
    { client: "default", useCookies: false, usePot: false, useMissingPotFlag: true },
  ];
}

export function buildExtractorArgsForStrategy(strat: ClientStrategy): string[] {
  if (strat.client === "default") {
    return strat.useMissingPotFlag ? ["--extractor-args", "youtube:formats=missing_pot"] : [];
  }
  return [
    "--extractor-args",
    strat.useMissingPotFlag
      ? `youtube:player_client=${strat.client};formats=missing_pot`
      : `youtube:player_client=${strat.client}`,
  ];
}

export function buildDownloadFormatPlan(options: {
  quality?: string | null;
  codec?: string | null;
}): { isStrict4K: boolean; sortArgs: string[]; formatSelectors: string[] } {
  const { quality, codec } = options;
  const isStrict4K = quality?.toLowerCase() === "4k";
  const maxH = quality ? (HEIGHT_MAP[quality.toLowerCase()] ?? 1080) : 1080;
  const vcodecFilter = codec && VCODEC_MAP[codec] ? `[vcodec^=${VCODEC_MAP[codec]}]` : "";

  if (isStrict4K) {
    // Strict 4K policy: NEVER accept below 2160p (supports both 16:9 height>=2160 and 9:16 width>=2160)
    const formatSelectors = vcodecFilter
      ? [
          `bestvideo*[height>=2160]${vcodecFilter}+bestaudio/bestvideo*[width>=2160][aspect_ratio<1]${vcodecFilter}+bestaudio/bestvideo*[height>=2160]+bestaudio/bestvideo*[width>=2160][aspect_ratio<1]+bestaudio`,
        ]
      : [
          "bestvideo*[height>=2160]+bestaudio/bestvideo*[width>=2160][aspect_ratio<1]+bestaudio/best[height>=2160]",
        ];
    return { isStrict4K: true, sortArgs: [], formatSelectors };
  }

  // Use yt-dlp -S "res:${maxH}" so portrait Shorts (e.g. 1080x1918) are NOT downgraded to 480p
  if (quality) {
    const formatSelectors = vcodecFilter
      ? [`bestvideo*${vcodecFilter}+bestaudio/bestvideo*+bestaudio/b`]
      : ["bestvideo*+bestaudio/b"];
    return { isStrict4K: false, sortArgs: ["-S", `res:${maxH}`], formatSelectors };
  }

  // Metadata-only ("No Download") fallback download at publish time:
  // Cap to 1080p on shorter edge and prefer MP4/M4A compatibility when available.
  return {
    isStrict4K: false,
    sortArgs: ["-S", "res:1080,ext:mp4:m4a"],
    formatSelectors: ["bestvideo*+bestaudio/b"],
  };
}

function getPrefixFileBytes(targetOutputPath: string): number {
  try {
    const dir = path.dirname(targetOutputPath);
    const base = path.basename(targetOutputPath, ".mp4");
    const entries = readdirSync(dir);
    let total = 0;
    for (const name of entries) {
      if (name.startsWith(base)) {
        try {
          total += statSync(path.join(dir, name)).size;
        } catch {
          // noop
        }
      }
    }
    return total;
  } catch {
    return 0;
  }
}

function cleanupPrefixFiles(targetOutputPath: string): void {
  try {
    const dir = path.dirname(targetOutputPath);
    const base = path.basename(targetOutputPath, ".mp4");
    const entries = readdirSync(dir);
    for (const name of entries) {
      if (name.startsWith(base)) {
        try {
          unlinkSync(path.join(dir, name));
        } catch {
          // noop
        }
      }
    }
  } catch {
    // noop
  }
}

interface SpawnYtDlpOptions {
  onProgress?: (pct: number) => void;
  timeoutMs?: number;
  stallTimeoutMs?: number;
  watchOutputPath?: string;
  signal?: AbortSignal;
}

function resolveYtDlpCommand(): { bin: string; prefixArgs: string[]; extraPythonPath?: string } {
  const pkgDir = "/tmp/ytdlp-pkg";
  const zipBin = "/tmp/ytdlp-bin/yt-dlp";
  if (existsSync("/usr/local/bin/yt-dlp")) {
    return { bin: "/usr/local/bin/yt-dlp", prefixArgs: [] };
  }
  if (existsSync("/usr/bin/yt-dlp")) {
    return { bin: "/usr/bin/yt-dlp", prefixArgs: [] };
  }
  if (existsSync(path.join(pkgDir, "yt_dlp", "__main__.py"))) {
    const basePy = (YTDLP_ENV as NodeJS.ProcessEnv).PYTHONPATH;
    const existingPy = basePy ? `${basePy}:${pkgDir}` : pkgDir;
    return { bin: "python3", prefixArgs: ["-m", "yt_dlp"], extraPythonPath: existingPy };
  }
  if (existsSync(zipBin)) {
    return { bin: "python3", prefixArgs: [zipBin] };
  }
  return { bin: "python3", prefixArgs: ["-m", "yt_dlp"] };
}

function spawnYtDlpRaw(
  args: string[],
  opts: SpawnYtDlpOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  const {
    onProgress,
    timeoutMs = 600_000,
    stallTimeoutMs = 90_000,
    watchOutputPath,
    signal,
  } = opts;

  if (signal?.aborted) {
    return Promise.reject(new Error("Stopped by user"));
  }

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let lastActivityAt = Date.now();
    let lastWatchedBytes = watchOutputPath ? getPrefixFileBytes(watchOutputPath) : 0;

    const storeDir = getVideoStoreDir();
    const resolved = resolveYtDlpCommand();
    const proc = spawn(resolved.bin, [...resolved.prefixArgs, ...args], {
      env: {
        ...YTDLP_ENV,
        ...(resolved.extraPythonPath ? { PYTHONPATH: resolved.extraPythonPath } : {}),
        PYTHONUNBUFFERED: "1",
        TMPDIR: storeDir,
      },
    });

    const cleanupTimers = () => {
      clearTimeout(totalTimer);
      clearInterval(stallWatch);
      signal?.removeEventListener("abort", onAbort);
    };

    const failWith = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanupTimers();
      try {
        proc.kill("SIGKILL");
      } catch {
        // noop
      }
      reject(err);
    };

    const onAbort = () => {
      failWith(new Error("Stopped by user"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const totalTimer = setTimeout(() => {
      failWith(new Error(`yt-dlp timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    const stallWatch = setInterval(() => {
      if (watchOutputPath) {
        const curBytes = getPrefixFileBytes(watchOutputPath);
        if (curBytes > lastWatchedBytes) {
          lastWatchedBytes = curBytes;
          lastActivityAt = Date.now();
        }
      }
      if (Date.now() - lastActivityAt >= stallTimeoutMs) {
        failWith(
          new Error(
            `yt-dlp stalled (no download progress for ${Math.round(stallTimeoutMs / 1000)}s): ${stderr.slice(-300)}`
          )
        );
      }
    }, 5_000);

    proc.stdout.on("data", (chunk: Buffer) => {
      lastActivityAt = Date.now();
      const text = chunk.toString();
      stdout += text;
      if (onProgress) {
        const lines = text.split(/[\r\n]+/);
        for (const line of lines) {
          const m = line.match(/(\d+(?:\.\d+)?)%/);
          if (m) {
            const pct = parseFloat(m[1]);
            if (!Number.isNaN(pct) && pct >= 0 && pct <= 100) {
              onProgress(pct);
            }
          }
        }
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      lastActivityAt = Date.now();
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      cleanupTimers();
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const lines = stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const errorLines = lines.filter((l) => /^ERROR:/i.test(l));
      const diagWarnings = lines.filter(
        (l) =>
          /^WARNING:/i.test(l) &&
          /n challenge|Signature solving|SABR|EJS|429|not a bot|timed out|Proxy/i.test(l)
      );
      const combined = [...diagWarnings.slice(-2), ...errorLines].join(" ");
      const conciseErr = combined ? combined.slice(-900) : stderr.slice(-900);
      reject(new Error(conciseErr || `yt-dlp exited with code ${code}`));
    });

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      cleanupTimers();
      reject(err);
    });
  });
}

async function probeVideoShortEdge(filePath: string): Promise<{ minDim: number; maxDim: number } | null> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", filePath],
      { timeout: 10_000 }
    );
    const parts = stdout.trim().split(",").map((n) => parseInt(n.trim(), 10));
    if (parts.length >= 2 && !Number.isNaN(parts[0]) && !Number.isNaN(parts[1]) && parts[0] > 0 && parts[1] > 0) {
      return { minDim: Math.min(parts[0], parts[1]), maxDim: Math.max(parts[0], parts[1]) };
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchYtDlpMetadataShared(url: string): Promise<YtDlpMeta> {
  const cookieCopy = await acquireJobCookieCopy("meta");
  const proxyList = await getStoredProxyList();
  const pot = await detectPotProvider();

  try {
    let metaProxyPool: Array<string | null> = [null];
    if (proxyList.length > 0) {
      const checks = await Promise.all(
        proxyList.map(async (proxy) => ({
          proxy,
          ...(await checkProxyReachability(proxy, 2500)),
        }))
      );
      const reachable = rankAndFilterHealthyProxies(
        checks.filter((c) => c.ok).map((c) => c.proxy)
      );
      if (reachable.length === 0) {
        logger.warn({ url, configuredProxies: proxyList.length }, "No configured proxies reachable for metadata fetch");
        return {};
      }
      metaProxyPool = rotateProxyPool(reachable).slice(0, 3);
    }

    const strategies = buildStrategies(cookieCopy.hasCookies, pot.mode !== "none");
    // Try primary strategy, and if it fails fall back to an android_vr client without cookies
    const candidates: ClientStrategy[] = [strategies[0]];
    const fallbackVr = strategies.find((s) => s.client === "android_vr") ?? {
      client: "android_vr",
      useCookies: false,
      usePot: false,
      useMissingPotFlag: true,
    };
    if (fallbackVr.client !== strategies[0].client) {
      candidates.push(fallbackVr);
    }

    for (const activeProxy of metaProxyPool) {
      for (const chosen of candidates) {
        const extractorArgs = buildExtractorArgsForStrategy(chosen);

        const args: string[] = [
          "--dump-json",
          "--no-playlist",
          "--skip-download",
          "--ignore-no-formats-error",
          "--socket-timeout", "25",
          "--retries", "1",
          "--extractor-retries", "1",
          ...JS_RUNTIME_ARGS,
          ...(chosen.usePot ? pot.extractorArgs : []),
          ...extractorArgs,
          ...(chosen.useCookies && cookieCopy.path
            ? chosen.client === "web"
              ? ["--cookies", cookieCopy.path, "--user-agent", CHROME_UA]
              : ["--cookies", cookieCopy.path]
            : []),
          ...(activeProxy ? ["--proxy", activeProxy] : []),
          url,
        ];

        try {
          const { stdout } = await spawnYtDlpRaw(args, { timeoutMs: 45_000, stallTimeoutMs: 35_000 });
          const raw = stdout.trim();
          if (raw) {
            return JSON.parse(raw) as YtDlpMeta;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(
            {
              url,
              client: chosen.client,
              proxy: activeProxy ? maskProxyUrl(activeProxy) : null,
              err: msg.slice(0, 220),
            },
            "yt-dlp metadata strategy failed"
          );
          if (
            activeProxy &&
            /ProxyError|Unable to connect to proxy|407 Proxy Authentication|SOCKS|proxyconnect|timed out/i.test(msg)
          ) {
            break;
          }
        }
      }
    }
    return {};
  } finally {
    cookieCopy.cleanup();
  }
}

export async function downloadVideoWithResilience(options: {
  url: string;
  quality?: string | null;
  outputPath: string;
  onProgress?: (pct: number) => void;
  codec?: string | null;
  jobTag?: string;
  signal?: AbortSignal;
}): Promise<void> {
  const { url, quality, outputPath, onProgress, codec, jobTag = "dl", signal } = options;
  const { isStrict4K, sortArgs, formatSelectors } = buildDownloadFormatPlan({ quality, codec });
  const uniqueFormats = Array.from(new Set(formatSelectors));
  const storeDir = getVideoStoreDir();
  const diskInfo = getDiskSpaceInfo(storeDir);
  if (diskInfo.availableMB !== null && diskInfo.availableMB < 200) {
    throw new Error(
      `[DISK_FULL] Only ${diskInfo.availableMB} MB free in ${storeDir}. Need at least 200 MB free space to start download.`
    );
  }

  const cookieCopy = await acquireJobCookieCopy(jobTag);
  const proxyList = await getStoredProxyList();
  const pot = await detectPotProvider();
  const strategies = buildStrategies(cookieCopy.hasCookies, pot.mode !== "none");

  const perAttemptTotalMs = isStrict4K ? 720_000 : 360_000;
  const perAttemptStallMs = isStrict4K ? 105_000 : 85_000;

  let lastError = "";
  let rateLimitHits = 0;
  let botCheckWithCookiesHit = false;
  let botCheckAnonHit = false;
  let formatMiss4KHit = false;
  let last4KFormatError = "";
  let noFormatsWithCookiesHit = false;
  let lastNoFormatsError = "";
  let stallHits = 0;
  let lastMaskedProxy: string | null = proxyList.length > 0 ? maskProxyUrl(proxyList[0]) : null;

  try {
    let activeProxyPool: Array<string | null> = [null];
    if (proxyList.length > 0) {
      const autoPruneEnabled = await getProxyAutoPruneEnabled();
      const checks = await Promise.all(
        proxyList.map(async (proxy) => ({
          proxy,
          ...(await checkProxyReachability(proxy, 3500)),
        }))
      );
      const deadProxies = checks.filter((c) => !c.ok).map((c) => c.proxy);
      for (const deadProxy of deadProxies) {
        recordProxyFailure(deadProxy);
        if (autoPruneEnabled) {
          await removeProxyFromStoredPool(deadProxy).catch(() => {});
        }
      }
      const reachableProxies = rankAndFilterHealthyProxies(
        checks.filter((c) => c.ok).map((c) => c.proxy)
      );
      if (reachableProxies.length === 0) {
        const summaryHost =
          proxyList.length === 1
            ? maskProxyUrl(proxyList[0])
            : `${maskProxyUrl(proxyList[0])} (+${proxyList.length - 1} more)`;
        throw new Error(
          classifyYtDlpError(
            `ProxyError: None of the ${proxyList.length} configured proxies could reach YouTube HTTPS right now.`,
            {
              quality,
              usedCookies: cookieCopy.hasCookies,
              usedProxy: true,
              proxyMaskedHost: summaryHost,
              potMode: pot.mode,
            }
          ).formattedMessage
        );
      }
      activeProxyPool = reachableProxies.length > 1 ? reachableProxies : rotateProxyPool(reachableProxies);
    }

    for (let pIdx = 0; pIdx < activeProxyPool.length; pIdx++) {
      const activeProxy = activeProxyPool[pIdx];
      const maskedActiveProxy = activeProxy ? maskProxyUrl(activeProxy) : null;
      if (maskedActiveProxy) lastMaskedProxy = maskedActiveProxy;
      const hasMoreProxies = pIdx < activeProxyPool.length - 1;

      const commonArgs = [
        ...sortArgs,
        "--merge-output-format", "mp4",
        "--no-playlist",
        "--no-check-formats",
        "--newline",
        "--progress",
        "--socket-timeout", "40",
        "--concurrent-fragments", activeProxy ? "1" : "2",
        "--retries", "2",
        "--extractor-retries", "2",
        "--paths", `temp:${storeDir}`,
        ...JS_RUNTIME_ARGS,
        ...(activeProxy ? ["--proxy", activeProxy] : []),
        "-o", outputPath,
      ];

      let proxyTimeoutHits = 0;
      let proxyRateLimitHits = 0;
      let rotateToNextProxy = false;

      for (let sIdx = 0; sIdx < strategies.length && !rotateToNextProxy; sIdx++) {
        if (signal?.aborted) {
          throw new Error("[CANCELLED] Stopped by user");
        }

        const strat = strategies[sIdx];
        const extractorArgs = buildExtractorArgsForStrategy(strat);

        for (const fmt of uniqueFormats) {
          if (signal?.aborted) {
            throw new Error("[CANCELLED] Stopped by user");
          }

          logger.info(
            {
              url,
              client: strat.client,
              quality: quality ?? "auto-1080p",
              isStrict4K,
              hasCookies: strat.useCookies && cookieCopy.hasCookies,
              potMode: strat.usePot ? pot.mode : "none",
              proxy: maskedActiveProxy,
              proxyAttempt: activeProxy ? `${pIdx + 1}/${activeProxyPool.length}` : undefined,
              freeDiskMB: diskInfo.availableMB,
            },
            "Trying yt-dlp download strategy"
          );

          try {
            cleanupPrefixFiles(outputPath);

            await spawnYtDlpRaw(
              [
                "-f", fmt,
                ...extractorArgs,
                ...(strat.usePot ? pot.extractorArgs : []),
                ...(strat.useCookies && cookieCopy.path
                  ? strat.client === "web"
                    ? ["--cookies", cookieCopy.path, "--user-agent", CHROME_UA]
                    : ["--cookies", cookieCopy.path]
                  : []),
                ...commonArgs,
                url,
              ],
              {
                onProgress,
                timeoutMs: perAttemptTotalMs,
                stallTimeoutMs: perAttemptStallMs,
                watchOutputPath: outputPath,
                signal,
              }
            );

            // Strict 4K verification via ffprobe (supports both 16:9 3840x2160 and 9:16 2160x3840)
            if (isStrict4K && existsSync(outputPath)) {
              const dims = await probeVideoShortEdge(outputPath);
              if (dims && dims.minDim < 2160 && dims.maxDim < 3840) {
                try { unlinkSync(outputPath); } catch { /* noop */ }
                throw new Error(
                  `[4K_UNAVAILABLE] Strict 4K aborted: downloaded stream resolution was ${dims.minDim}p (< 2160p).`
                );
              }
            }

            if (activeProxy) {
              recordProxySuccess(activeProxy, null);
            }

            logger.info(
              {
                url,
                client: strat.client,
                quality: quality ?? "auto-1080p",
                proxy: maskedActiveProxy,
              },
              "Download succeeded"
            );
            return;
          } catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
            cleanupPrefixFiles(outputPath);

            if (signal?.aborted || /Stopped by user|\[CANCELLED\]/i.test(lastError)) {
              throw new Error("[CANCELLED] Stopped by user");
            }

            logger.warn(
              {
                url,
                client: strat.client,
                proxy: maskedActiveProxy,
                err: lastError.slice(0, 180),
              },
              "yt-dlp strategy failed"
            );

            if (/ENOSPC|No space left on device|Disk quota exceeded|\[DISK_FULL\]/i.test(lastError)) {
              throw new Error(
                classifyYtDlpError(lastError, {
                  quality,
                  usedCookies: cookieCopy.hasCookies,
                  usedProxy: Boolean(activeProxy),
                  proxyMaskedHost: maskedActiveProxy,
                  potMode: pot.mode,
                }).formattedMessage
              );
            }

            if (/ProxyError|Unable to connect to proxy|407 Proxy Authentication|SOCKS|proxyconnect|Connection reset by peer|Connection refused/i.test(lastError)) {
              if (activeProxy) {
                recordProxyFailure(activeProxy);
                if (await getProxyAutoPruneEnabled()) {
                  await removeProxyFromStoredPool(activeProxy).catch(() => {});
                  logger.info({ proxy: maskedActiveProxy }, "Auto-pruned failing proxy from saved pool");
                }
              }
              if (hasMoreProxies) {
                rotateToNextProxy = true;
                break;
              }
              throw new Error(
                classifyYtDlpError(lastError, {
                  quality,
                  usedCookies: cookieCopy.hasCookies,
                  usedProxy: Boolean(activeProxy),
                  proxyMaskedHost: maskedActiveProxy,
                  potMode: pot.mode,
                }).formattedMessage
              );
            }

            if (activeProxy && /timed out|TransportError|stalled/i.test(lastError)) {
              proxyTimeoutHits++;
              if (proxyTimeoutHits >= 2) {
                const entry = recordProxyFailure(activeProxy);
                if (entry.failCount >= 2 && (await getProxyAutoPruneEnabled())) {
                  await removeProxyFromStoredPool(activeProxy).catch(() => {});
                  logger.info({ proxy: maskedActiveProxy }, "Auto-pruned timed-out proxy from saved pool");
                }
                if (hasMoreProxies) {
                  rotateToNextProxy = true;
                  break;
                }
                throw new Error(
                  classifyYtDlpError(lastError, {
                    quality,
                    usedCookies: cookieCopy.hasCookies,
                    usedProxy: true,
                    proxyMaskedHost: maskedActiveProxy,
                    potMode: pot.mode,
                  }).formattedMessage
                );
              }
            }

            if (/429|Too Many Requests/i.test(lastError)) {
              rateLimitHits++;
              proxyRateLimitHits++;
              if (proxyRateLimitHits >= 1 && hasMoreProxies) {
                rotateToNextProxy = true;
                break;
              }
              if (rateLimitHits >= 2) {
                throw new Error(
                  classifyYtDlpError(lastError, {
                    quality,
                    usedCookies: cookieCopy.hasCookies,
                    usedProxy: Boolean(activeProxy),
                    proxyMaskedHost: maskedActiveProxy,
                    potMode: pot.mode,
                  }).formattedMessage
                );
              }
            }

            if (activeProxy && /No video formats found/i.test(lastError) && hasMoreProxies) {
              rotateToNextProxy = true;
              break;
            }

            if (/Sign in to confirm you.?re not a bot|cookies are no longer valid|do-i-pass-cookies-to-yt-dlp/i.test(lastError)) {
              if (strat.useCookies && cookieCopy.hasCookies) {
                botCheckWithCookiesHit = true;
              } else {
                botCheckAnonHit = true;
              }
            }

            if (/Requested format is not available|\[4K_UNAVAILABLE\]/i.test(lastError) && isStrict4K) {
              formatMiss4KHit = true;
              if (!last4KFormatError || (strat.useCookies && cookieCopy.hasCookies)) {
                last4KFormatError = lastError;
              }
            }

            if (
              strat.useCookies &&
              cookieCopy.hasCookies &&
              /No video formats found|n challenge solving failed|Signature solving failed|SABR-only/i.test(lastError)
            ) {
              noFormatsWithCookiesHit = true;
              lastNoFormatsError = lastError;
            }

            if (/stalled|timed out/i.test(lastError)) {
              stallHits++;
            }

            await sleep(1000, signal);
          }
        }

        if (!rotateToNextProxy && sIdx < strategies.length - 1) {
          await sleep(1200, signal);
        }
      }

      if (hasMoreProxies) {
        logger.info(
          { url, failedProxy: maskedActiveProxy, nextProxyIndex: pIdx + 2, totalProxies: activeProxyPool.length },
          "Rotating to next proxy in pool"
        );
        await sleep(600, signal);
      }
    }

    const prioritizedError =
      rateLimitHits > 0 && !/429|Too Many Requests/i.test(lastError)
        ? `HTTP Error 429: Too Many Requests (${lastError})`
        : formatMiss4KHit && isStrict4K && !botCheckWithCookiesHit
        ? (last4KFormatError || "Requested format is not available for 2160p.")
        : noFormatsWithCookiesHit && !botCheckWithCookiesHit
        ? lastNoFormatsError
        : (botCheckWithCookiesHit || (!formatMiss4KHit && !noFormatsWithCookiesHit && botCheckAnonHit)) &&
          !/not a bot|do-i-pass-cookies-to-yt-dlp|cookies are no longer valid/i.test(lastError)
        ? `Sign in to confirm you're not a bot (${lastError})`
        : stallHits > 0 && !/stalled|timed out/i.test(lastError)
        ? `Download stalled waiting on YouTube stream (${lastError})`
        : lastError;

    const summaryHost =
      proxyList.length <= 1
        ? lastMaskedProxy
        : `${maskProxyUrl(proxyList[0])} (+${proxyList.length - 1} more)`;

    const classified = classifyYtDlpError(prioritizedError, {
      quality,
      usedCookies: cookieCopy.hasCookies && ((!formatMiss4KHit && !noFormatsWithCookiesHit) || botCheckWithCookiesHit),
      usedProxy: proxyList.length > 0,
      proxyMaskedHost: summaryHost,
      potMode: pot.mode,
    });
    throw new Error(classified.formattedMessage);
  } finally {
    cookieCopy.cleanup();
  }
}

export interface DiagnosticsReport {
  ytDlp: { ok: boolean; version: string | null; error: string | null };
  potServer: { ok: boolean; mode: "http" | "script" | "none"; endpoint: string | null };
  proxy: {
    configured: boolean;
    count: number;
    reachableCount: number;
    maskedHost: string | null;
    proxies: Array<{ maskedHost: string; ok: boolean; latencyMs: number | null; error: string | null }>;
    ok: boolean | null;
    error: string | null;
  };
  storage: DiskSpaceInfo;
  probe: {
    attempted: boolean;
    ok: boolean | null;
    maxHeight: number | null;
    has4k: boolean | null;
    clientUsed: string | null;
    errorCode: YtDlpErrorCode | null;
    message: string | null;
  };
}

export async function runYtDlpDiagnostics(opts: {
  testUrl?: string;
  proxyOverride?: string | null;
  proxyListOverride?: string[] | null;
  runLiveProbe?: boolean;
}): Promise<DiagnosticsReport> {
  let ytDlpVersion: string | null = null;
  let ytDlpErr: string | null = null;
  try {
    const { stdout } = await spawnYtDlpRaw(["--version"], { timeoutMs: 10_000, stallTimeoutMs: 10_000 });
    ytDlpVersion = stdout.trim();
  } catch (err) {
    ytDlpErr = err instanceof Error ? err.message : "yt-dlp not found";
  }

  const pot = await detectPotProvider();
  const storage = getDiskSpaceInfo();

  const proxyList =
    opts.proxyListOverride !== undefined
      ? opts.proxyListOverride ?? []
      : opts.proxyOverride !== undefined
      ? opts.proxyOverride
        ? [opts.proxyOverride]
        : []
      : await getStoredProxyList();

  const maskedList = proxyList.map(maskProxyUrl);
  const summaryMaskedHost =
    maskedList.length === 0
      ? null
      : maskedList.length === 1
      ? maskedList[0]
      : `${maskedList[0]} (+${maskedList.length - 1} more)`;

  let proxyOk: boolean | null = null;
  let proxyErr: string | null = null;
  let proxyStatuses: Array<{ maskedHost: string; ok: boolean; latencyMs: number | null; error: string | null }> = [];
  let reachableProxies: string[] = [];

  if (proxyList.length > 0 && ytDlpVersion) {
    const checks = await Promise.all(
      proxyList.map(async (proxy) => ({
        proxy,
        maskedHost: maskProxyUrl(proxy),
        ...(await checkProxyReachability(proxy, 3500)),
      }))
    );
    proxyStatuses = checks
      .map((c) => ({
        maskedHost: c.maskedHost,
        ok: c.ok,
        latencyMs: c.latencyMs,
        error: c.error,
      }))
      .sort((a, b) => {
        if (a.ok !== b.ok) return a.ok ? -1 : 1;
        return (a.latencyMs ?? 99999) - (b.latencyMs ?? 99999);
      });
    reachableProxies = rankAndFilterHealthyProxies(
      checks.filter((c) => c.ok).map((c) => c.proxy)
    );
    proxyOk = reachableProxies.length > 0;
    if (!proxyOk) {
      proxyErr =
        proxyStatuses.length === 1
          ? proxyStatuses[0]?.error || "Failed to reach proxy host"
          : `All ${proxyStatuses.length} proxies failed tunnel check (${proxyStatuses[0]?.error || "timed out"})`;
    }
  }

  const report: DiagnosticsReport = {
    ytDlp: { ok: Boolean(ytDlpVersion), version: ytDlpVersion, error: ytDlpErr },
    potServer: {
      ok: pot.mode !== "none",
      mode: pot.mode,
      endpoint: pot.mode === "http" ? pot.httpUrl : pot.scriptServerHome,
    },
    proxy: {
      configured: proxyList.length > 0,
      count: proxyList.length,
      reachableCount: reachableProxies.length,
      maskedHost: summaryMaskedHost,
      proxies: proxyStatuses,
      ok: proxyOk,
      error: proxyErr,
    },
    storage,
    probe: {
      attempted: false,
      ok: null,
      maxHeight: null,
      has4k: null,
      clientUsed: null,
      errorCode: null,
      message: null,
    },
  };

  if (opts.runLiveProbe === false || !ytDlpVersion || (proxyList.length > 0 && reachableProxies.length === 0)) {
    return report;
  }

  const targetUrl = opts.testUrl || "https://www.youtube.com/watch?v=jNQXAC9IVRw";
  report.probe.attempted = true;

  const cookieCopy = await acquireJobCookieCopy("diag");
  try {
    const strategies = buildStrategies(cookieCopy.hasCookies, pot.mode !== "none");

    const runProbeAttempt = async (strat: ClientStrategy, proxyArg: string | null) => {
      const extractorArgs = buildExtractorArgsForStrategy(strat);
      const { stdout } = await spawnYtDlpRaw(
        [
          "--dump-single-json",
          "--simulate",
          "--no-playlist",
          "--skip-download",
          "--socket-timeout", "25",
          ...JS_RUNTIME_ARGS,
          ...(strat.usePot ? pot.extractorArgs : []),
          ...extractorArgs,
          ...(strat.useCookies && cookieCopy.path
            ? strat.client === "web"
              ? ["--cookies", cookieCopy.path, "--user-agent", CHROME_UA]
              : ["--cookies", cookieCopy.path]
            : []),
          ...(proxyArg ? ["--proxy", proxyArg] : []),
          targetUrl,
        ],
        { timeoutMs: 40_000, stallTimeoutMs: 35_000 }
      );
      const parsed = JSON.parse(stdout) as { formats?: Array<{ width?: number; height?: number; vcodec?: string }> };
      const heights = (parsed.formats ?? [])
        .filter((f) => typeof f.height === "number" && f.height > 0 && f.vcodec !== "none")
        .map((f) => (typeof f.width === "number" && f.width > 0 ? Math.min(f.width, f.height!) : f.height!));
      return heights.length > 0 ? Math.max(...heights) : null;
    };

    const probeProxyPool: Array<string | null> =
      reachableProxies.length > 0 ? reachableProxies.slice(0, 3) : [null];

    let lastRawErr = "";
    let lastClientUsed = strategies[0].client;

    for (const proxyArg of probeProxyPool) {
      for (const chosen of strategies) {
        lastClientUsed = chosen.client;
        try {
          const maxHeight = await runProbeAttempt(chosen, proxyArg);
          report.probe.ok = true;
          report.probe.clientUsed = chosen.client;
          report.probe.maxHeight = maxHeight;
          report.probe.has4k = maxHeight !== null ? maxHeight >= 2160 : false;
          const viaSuffix = proxyArg ? ` through ${maskProxyUrl(proxyArg)}` : "";
          report.probe.message = maxHeight
            ? `YouTube stream probe succeeded via ${chosen.client}${viaSuffix} (max ${maxHeight}p available).`
            : `YouTube metadata probe succeeded via ${chosen.client}${viaSuffix}.`;
          return report;
        } catch (err) {
          lastRawErr = err instanceof Error ? err.message : String(err);
        }
      }
    }

    // If proxies were configured and all proxied attempts failed, test direct connection once
    // so the user knows whether their proxy IPs are what broke YouTube format extraction.
    let directHint = "";
    if (reachableProxies.length > 0) {
      try {
        const directMax = await runProbeAttempt(strategies[0], null);
        if (directMax) {
          directHint = ` Direct server check (bypassing proxy) succeeded at ${directMax}p — your configured proxy IP(s) may be restricted or returning incomplete streams.`;
        }
      } catch {
        // ignore direct failure
      }
    }

    const classified = classifyYtDlpError(lastRawErr || "No playable video formats returned", {
      usedCookies: cookieCopy.hasCookies,
      usedProxy: proxyList.length > 0,
      proxyMaskedHost: summaryMaskedHost,
      potMode: pot.mode,
    });
    report.probe.ok = false;
    report.probe.clientUsed = lastClientUsed;
    report.probe.errorCode = classified.code;
    report.probe.message = `${classified.formattedMessage}${directHint}`;
  } finally {
    cookieCopy.cleanup();
  }

  return report;
}
