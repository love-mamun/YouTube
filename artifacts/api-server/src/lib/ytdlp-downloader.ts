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
  getStoredProxyUrl,
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

function buildStrategies(hasCookies: boolean, hasPot: boolean): ClientStrategy[] {
  if (hasPot && hasCookies) {
    return [
      { client: "web", useCookies: true, usePot: true, useMissingPotFlag: false },
      { client: "tv_embedded", useCookies: true, usePot: true, useMissingPotFlag: false },
      { client: "mweb", useCookies: true, usePot: true, useMissingPotFlag: false },
      { client: "web", useCookies: false, usePot: true, useMissingPotFlag: false },
      { client: "android_vr", useCookies: false, usePot: false, useMissingPotFlag: true },
    ];
  }
  if (hasPot && !hasCookies) {
    return [
      { client: "web", useCookies: false, usePot: true, useMissingPotFlag: false },
      { client: "android_vr", useCookies: false, usePot: false, useMissingPotFlag: true },
      { client: "mweb", useCookies: false, usePot: true, useMissingPotFlag: false },
    ];
  }
  if (!hasPot && hasCookies) {
    // Without PO token server, tv_embedded & android_vr avoid web SABR stalls
    return [
      { client: "tv_embedded", useCookies: true, usePot: false, useMissingPotFlag: true },
      { client: "android_vr", useCookies: false, usePot: false, useMissingPotFlag: true },
      { client: "web", useCookies: true, usePot: false, useMissingPotFlag: true },
    ];
  }
  return [
    { client: "android_vr", useCookies: false, usePot: false, useMissingPotFlag: true },
    { client: "tv_embedded", useCookies: false, usePot: false, useMissingPotFlag: true },
  ];
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
    const proc = spawn("python3", ["-m", "yt_dlp", ...args], {
      env: { ...YTDLP_ENV, PYTHONUNBUFFERED: "1", TMPDIR: storeDir },
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
      const errorLines = stderr
        .split(/\r?\n/)
        .filter((l) => /^ERROR:/i.test(l.trim()));
      const conciseErr =
        errorLines.length > 0
          ? errorLines.join(" ").slice(-800)
          : stderr.slice(-800);
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

async function probeVideoHeight(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=height", "-of", "csv=p=0", filePath],
      { timeout: 10_000 }
    );
    const parsed = parseInt(stdout.trim(), 10);
    return Number.isNaN(parsed) ? null : parsed;
  } catch {
    return null;
  }
}

export async function fetchYtDlpMetadataShared(url: string): Promise<YtDlpMeta> {
  const cookieCopy = await acquireJobCookieCopy("meta");
  const proxyUrl = await getStoredProxyUrl();
  const pot = await detectPotProvider();

  try {
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

    for (const chosen of candidates) {
      const extractorVal = chosen.useMissingPotFlag
        ? `youtube:player_client=${chosen.client};formats=missing_pot`
        : `youtube:player_client=${chosen.client}`;

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
        "--extractor-args", extractorVal,
        ...(chosen.useCookies && cookieCopy.path ? ["--cookies", cookieCopy.path, "--user-agent", CHROME_UA] : []),
        ...(proxyUrl ? ["--proxy", proxyUrl] : []),
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
        logger.warn({ url, client: chosen.client, err: msg.slice(0, 220) }, "yt-dlp metadata strategy failed");
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
  const isStrict4K = quality?.toLowerCase() === "4k";
  const maxH = quality ? (HEIGHT_MAP[quality.toLowerCase()] ?? 1080) : 1080;
  const vcodecFilter = codec && VCODEC_MAP[codec] ? `[vcodec^=${VCODEC_MAP[codec]}]` : "";

  const formatSelectors: string[] = [];
  if (isStrict4K) {
    // Strict 4K policy: NEVER match below 2160p, NEVER fall back to "best"
    if (vcodecFilter) {
      formatSelectors.push(
        `bestvideo*[height>=2160]${vcodecFilter}+bestaudio/bestvideo*[height>=2160]+bestaudio`
      );
    } else {
      formatSelectors.push(
        "bestvideo*[height>=2160]+bestaudio/best[height>=2160]"
      );
    }
  } else if (quality) {
    if (vcodecFilter) {
      formatSelectors.push(
        `bestvideo*[height<=${maxH}]${vcodecFilter}+bestaudio/bestvideo*[height<=${maxH}]+bestaudio/b[height<=${maxH}]/b`
      );
    } else {
      formatSelectors.push(
        `bestvideo*[height<=${maxH}]+bestaudio/b[height<=${maxH}]/b`
      );
    }
  } else {
    // Metadata-only ("No Download") fallback download at publish time:
    // Cap to 1080p MP4-compatible streams so publishing doesn't pull massive 4K/8K files unexpectedly.
    formatSelectors.push(
      "bestvideo*[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo*[height<=1080]+bestaudio/b[height<=1080]/b"
    );
  }

  const uniqueFormats = Array.from(new Set(formatSelectors));
  const storeDir = getVideoStoreDir();
  const diskInfo = getDiskSpaceInfo(storeDir);
  if (diskInfo.availableMB !== null && diskInfo.availableMB < 200) {
    throw new Error(
      `[DISK_FULL] Only ${diskInfo.availableMB} MB free in ${storeDir}. Need at least 200 MB free space to start download.`
    );
  }

  const cookieCopy = await acquireJobCookieCopy(jobTag);
  const proxyUrl = await getStoredProxyUrl();
  const maskedProxy = proxyUrl ? maskProxyUrl(proxyUrl) : null;
  const pot = await detectPotProvider();
  const strategies = buildStrategies(cookieCopy.hasCookies, pot.mode !== "none");

  const commonArgs = [
    "--merge-output-format", "mp4",
    "--no-playlist",
    "--no-check-formats",
    "--newline",
    "--progress",
    "--socket-timeout", "40",
    "--concurrent-fragments", proxyUrl ? "1" : "2",
    "--retries", "2",
    "--extractor-retries", "2",
    "--paths", `temp:${storeDir}`,
    ...JS_RUNTIME_ARGS,
    ...(proxyUrl ? ["--proxy", proxyUrl] : []),
    "-o", outputPath,
  ];

  let lastError = "";
  let rateLimitHits = 0;
  let botCheckHit = false;
  let formatMiss4KHit = false;
  let stallHits = 0;
  let proxyTimeoutHits = 0;

  const perAttemptTotalMs = isStrict4K ? 720_000 : 360_000;
  const perAttemptStallMs = isStrict4K ? 105_000 : 85_000;

  try {
    for (let sIdx = 0; sIdx < strategies.length; sIdx++) {
      if (signal?.aborted) {
        throw new Error("[CANCELLED] Stopped by user");
      }

      const strat = strategies[sIdx];
      const extractorVal = strat.useMissingPotFlag
        ? `youtube:player_client=${strat.client};formats=missing_pot`
        : `youtube:player_client=${strat.client}`;

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
            proxy: maskedProxy,
            freeDiskMB: diskInfo.availableMB,
          },
          "Trying yt-dlp download strategy"
        );

        try {
          cleanupPrefixFiles(outputPath);

          await spawnYtDlpRaw(
            [
              "-f", fmt,
              "--extractor-args", extractorVal,
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

          // Strict 4K verification via ffprobe
          if (isStrict4K && existsSync(outputPath)) {
            const actualHeight = await probeVideoHeight(outputPath);
            if (actualHeight !== null && actualHeight < 2160) {
              try { unlinkSync(outputPath); } catch { /* noop */ }
              throw new Error(
                `[4K_UNAVAILABLE] Strict 4K aborted: downloaded stream height was ${actualHeight}p (< 2160p).`
              );
            }
          }

          logger.info({ url, client: strat.client, quality: quality ?? "auto-1080p" }, "Download succeeded");
          return;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          cleanupPrefixFiles(outputPath);

          if (signal?.aborted || /Stopped by user|\[CANCELLED\]/i.test(lastError)) {
            throw new Error("[CANCELLED] Stopped by user");
          }

          logger.warn(
            { url, client: strat.client, err: lastError.slice(0, 180) },
            "yt-dlp strategy failed"
          );

          if (/ENOSPC|No space left on device|Disk quota exceeded|\[DISK_FULL\]/i.test(lastError)) {
            throw new Error(
              classifyYtDlpError(lastError, {
                quality,
                usedCookies: cookieCopy.hasCookies,
                usedProxy: Boolean(proxyUrl),
                proxyMaskedHost: maskedProxy,
                potMode: pot.mode,
              }).formattedMessage
            );
          }

          if (/ProxyError|Unable to connect to proxy|407 Proxy Authentication|SOCKS|proxyconnect/i.test(lastError)) {
            throw new Error(
              classifyYtDlpError(lastError, {
                quality,
                usedCookies: cookieCopy.hasCookies,
                usedProxy: Boolean(proxyUrl),
                proxyMaskedHost: maskedProxy,
                potMode: pot.mode,
              }).formattedMessage
            );
          }

          if (proxyUrl && /timed out|TransportError|stalled/i.test(lastError)) {
            proxyTimeoutHits++;
            if (proxyTimeoutHits >= 2) {
              throw new Error(
                classifyYtDlpError(lastError, {
                  quality,
                  usedCookies: cookieCopy.hasCookies,
                  usedProxy: true,
                  proxyMaskedHost: maskedProxy,
                  potMode: pot.mode,
                }).formattedMessage
              );
            }
          }

          if (/429|Too Many Requests/i.test(lastError)) {
            rateLimitHits++;
            if (rateLimitHits >= 2) {
              throw new Error(
                classifyYtDlpError(lastError, {
                  quality,
                  usedCookies: cookieCopy.hasCookies,
                  usedProxy: Boolean(proxyUrl),
                  proxyMaskedHost: maskedProxy,
                  potMode: pot.mode,
                }).formattedMessage
              );
            }
          }

          if (/Sign in to confirm you.?re not a bot|cookies are no longer valid|do-i-pass-cookies-to-yt-dlp/i.test(lastError)) {
            botCheckHit = true;
          }

          if (/Requested format is not available/i.test(lastError) && isStrict4K) {
            formatMiss4KHit = true;
          }

          if (/stalled|timed out/i.test(lastError)) {
            stallHits++;
          }

          await sleep(1000, signal);
        }
      }

      if (sIdx < strategies.length - 1) {
        await sleep(1200, signal);
      }
    }

    const prioritizedError =
      rateLimitHits > 0 && !/429|Too Many Requests/i.test(lastError)
        ? `HTTP Error 429: Too Many Requests (${lastError})`
        : botCheckHit && !/not a bot|do-i-pass-cookies-to-yt-dlp/i.test(lastError)
        ? `Sign in to confirm you're not a bot (${lastError})`
        : formatMiss4KHit && isStrict4K && !/4K_UNAVAILABLE/i.test(lastError)
        ? `Requested format is not available for 2160p (${lastError})`
        : stallHits > 0 && !/stalled|timed out/i.test(lastError)
        ? `Download stalled waiting on YouTube stream (${lastError})`
        : lastError;

    const classified = classifyYtDlpError(prioritizedError, {
      quality,
      usedCookies: cookieCopy.hasCookies,
      usedProxy: Boolean(proxyUrl),
      proxyMaskedHost: maskedProxy,
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
  proxy: { configured: boolean; maskedHost: string | null; ok: boolean | null; error: string | null };
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

  const effectiveProxy = opts.proxyOverride !== undefined ? opts.proxyOverride : await getStoredProxyUrl();
  const maskedEffectiveProxy = effectiveProxy ? maskProxyUrl(effectiveProxy) : null;
  let proxyOk: boolean | null = null;
  let proxyErr: string | null = null;

  if (effectiveProxy && ytDlpVersion) {
    try {
      const parsed = new URL(effectiveProxy);
      const port = Number(parsed.port);
      await new Promise<void>((resolve, reject) => {
        const socket = net.createConnection({ host: parsed.hostname, port, timeout: 4000 }, () => {
          socket.destroy();
          resolve();
        });
        socket.on("error", (e) => reject(e));
        socket.on("timeout", () => {
          socket.destroy();
          reject(new Error("Proxy connection timed out (4s)"));
        });
      });
      proxyOk = true;
    } catch (err) {
      proxyOk = false;
      proxyErr = err instanceof Error ? err.message : "Failed to reach proxy host";
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
      configured: Boolean(effectiveProxy),
      maskedHost: maskedEffectiveProxy,
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

  if (opts.runLiveProbe === false || !ytDlpVersion || proxyOk === false) {
    return report;
  }

  const targetUrl = opts.testUrl || "https://www.youtube.com/watch?v=jNQXAC9IVRw";
  report.probe.attempted = true;

  const cookieCopy = await acquireJobCookieCopy("diag");
  try {
    const strategies = buildStrategies(cookieCopy.hasCookies, pot.mode !== "none");
    const chosen = strategies[0];
    report.probe.clientUsed = chosen.client;

    const extractorVal = chosen.useMissingPotFlag
      ? `youtube:player_client=${chosen.client};formats=missing_pot`
      : `youtube:player_client=${chosen.client}`;

    const { stdout } = await spawnYtDlpRaw(
      [
        "--dump-single-json",
        "--simulate",
        "--no-playlist",
        "--skip-download",
        "--socket-timeout", "25",
        ...JS_RUNTIME_ARGS,
        ...(chosen.usePot ? pot.extractorArgs : []),
        "--extractor-args", extractorVal,
        ...(chosen.useCookies && cookieCopy.path ? ["--cookies", cookieCopy.path, "--user-agent", CHROME_UA] : []),
        ...(effectiveProxy ? ["--proxy", effectiveProxy] : []),
        targetUrl,
      ],
      { timeoutMs: 40_000, stallTimeoutMs: 35_000 }
    );

    const parsed = JSON.parse(stdout) as { formats?: Array<{ height?: number; vcodec?: string }> };
    const heights = (parsed.formats ?? [])
      .filter((f) => typeof f.height === "number" && f.height > 0 && f.vcodec !== "none")
      .map((f) => f.height as number);
    const maxHeight = heights.length > 0 ? Math.max(...heights) : null;

    report.probe.ok = true;
    report.probe.maxHeight = maxHeight;
    report.probe.has4k = maxHeight !== null ? maxHeight >= 2160 : false;
    report.probe.message = maxHeight
      ? `YouTube stream probe succeeded via ${chosen.client} (max ${maxHeight}p available).`
      : `YouTube metadata probe succeeded via ${chosen.client}.`;
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const classified = classifyYtDlpError(raw, {
      usedCookies: cookieCopy.hasCookies,
      usedProxy: Boolean(effectiveProxy),
      proxyMaskedHost: maskedEffectiveProxy,
      potMode: pot.mode,
    });
    report.probe.ok = false;
    report.probe.errorCode = classified.code;
    report.probe.message = classified.formattedMessage;
  } finally {
    cookieCopy.cleanup();
  }

  return report;
}
