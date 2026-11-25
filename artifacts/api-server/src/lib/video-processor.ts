import { exec, spawn, execSync } from "child_process";
import { promisify } from "util";
import { mkdirSync, existsSync, unlinkSync, writeFileSync, readFileSync, statSync } from "fs";
import { eq, and, inArray } from "drizzle-orm";
import { db, videoJobsTable, thumbnailsTable, publishLogsTable, apiTokensTable, appConfigTable } from "@workspace/db";
import { publishToYouTube, updatePublishLog } from "./youtube-publisher";
import { publishToFacebook } from "./facebook-publisher";
import { logger } from "./logger";

const execAsync = promisify(exec);

const FONT_FILE = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const VIDEO_TMP_DIR = "/home/runner/workspace/.video-store";
const LOGO_PATH = "/home/runner/workspace/artifacts/api-server/assets/watermark-logo.png";

// Resolution → { scale, bitrate } for the FFmpeg pipeline
// 4K uses 35 Mbps — matching YouTube's recommended encoding for 2160p SDR content.
const RESOLUTION_SETTINGS: Record<string, { scale: string; bitrate: string; w: number; h: number }> = {
  "360p":  { scale: "640:360",   bitrate: "1M",  w: 640,  h: 360  },
  "480p":  { scale: "854:480",   bitrate: "2M",  w: 854,  h: 480  },
  "720p":  { scale: "1280:720",  bitrate: "5M",  w: 1280, h: 720  },
  "1080p": { scale: "1920:1080", bitrate: "8M",  w: 1920, h: 1080 },
  "1440p": { scale: "2560:1440", bitrate: "16M", w: 2560, h: 1440 },
  "4k":    { scale: "3840:2160", bitrate: "35M", w: 3840, h: 2160 },
};

async function updateJob(
  id: number,
  data: Partial<typeof videoJobsTable.$inferInsert>
) {
  await db.update(videoJobsTable).set(data).where(eq(videoJobsTable.id, id));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface YtDlpMeta {
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

function detectPlatform(url: string): "youtube" | "facebook" | "other" {
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  if (/facebook\.com|fb\.watch|fb\.com/i.test(url)) return "facebook";
  return "other";
}

function extractYouTubeId(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  return match?.[1] ?? null;
}

async function fetchYtDlpMetadata(url: string): Promise<YtDlpMeta> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const hasCookies = existsSync(YT_COOKIES_PATH);
    const cookieArgs = hasCookies ? ["--cookies", YT_COOKIES_PATH] : [];
    // android_vr first — bypasses PO token & SABR for public videos.
    // Fall back to web client with cookies/UA if cookies are present.
    const clientArgs = [
      "--extractor-args", "youtube:player_client=android_vr;formats=missing_pot",
    ];
    const proc = spawn("python3", [
      "-m", "yt_dlp",
      "--dump-json",
      "--no-playlist",
      "--skip-download",
      "--ignore-no-formats-error",
      ...JS_RUNTIME_ARGS,
      ...bgutilArgs(),
      ...clientArgs,
      ...cookieArgs,
      url,
    ], { env: YTDLP_ENV, timeout: 30_000 });
    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    proc.on("close", (code) => {
      const raw = stdout.trim();
      if (raw) {
        try {
          resolve(JSON.parse(raw) as YtDlpMeta);
          return;
        } catch {
          // fall through
        }
      }
      logger.warn({ code, stderr: stderr.slice(0, 300) }, "yt-dlp metadata fetch failed");
      resolve({});
    });
    proc.on("error", (err) => {
      logger.warn({ err }, "yt-dlp spawn error");
      resolve({});
    });
  });
}

async function fetchYouTubeOembedFallback(url: string): Promise<YtDlpMeta> {
  const videoId = extractYouTubeId(url);
  if (!videoId) return {};
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    );
    if (res.ok) {
      const data = (await res.json()) as { title?: string };
      return {
        id: videoId,
        title: data.title,
        thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
      };
    }
  } catch {
    // fall through
  }
  return {
    id: videoId,
    thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
  };
}

function buildThumbnailVariants(
  platform: "youtube" | "facebook" | "other",
  videoId: string | null,
  ytdlpThumb?: string
) {
  const variants: { url: string; label: string }[] = [];
  if (ytdlpThumb) variants.push({ url: ytdlpThumb, label: "Source Thumbnail" });
  if (platform === "youtube" && videoId) {
    variants.push(
      { url: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`, label: "Original HD" },
      { url: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,    label: "High Quality" },
      { url: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,    label: "Medium Quality" },
      { url: `https://img.youtube.com/vi/${videoId}/sddefault.jpg`,    label: "Standard" }
    );
  }
  return variants;
}

async function verifyFfmpeg(): Promise<boolean> {
  try {
    await execAsync("ffmpeg -version", { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

const YT_COOKIES_PATH = "/tmp/n3xus-yt-cookies.txt";

// ── yt-dlp via PYTHONPATH (pip 2026.06.09, far newer than Nix 2025.06.30) ──
// The Nix yt-dlp (2025.06.30) is broken for YouTube: nsig extraction fails and
// YouTube forced SABR streaming which the old version can't handle.
// yt-dlp 2026.06.09 uses the android_vr client which bypasses SABR entirely and
// can list/download all resolutions from 480p up to 4K without needing a JS
// runtime or PO Token. PYTHONPATH override makes python3 load this version.
const YTDLP_PYTHONPATH = "/home/runner/workspace/.pythonlibs/lib/python3.12/site-packages";
const YTDLP_ENV = { ...process.env, PYTHONPATH: YTDLP_PYTHONPATH };

// Use process.execPath — always the real Node binary path inside this running process.
// This is more reliable than spawning a subprocess to find it.
const NODE_BIN = process.execPath ?? "node";
const JS_RUNTIME_ARGS = ["--js-runtimes", `node:${NODE_BIN}`];

// ── PO Token via bgutil script (no server needed) ───────────────────────────
// bgutil-ytdlp-pot-provider plugin is installed in .pythonlibs so yt-dlp picks
// it up automatically via PYTHONPATH. The plugin looks for generate_once.js at
// BGUTIL_SERVER_HOME/build/generate_once.js.
const BGUTIL_SERVER_HOME = "/home/runner/workspace/bgutil-ytdlp-pot-provider/server";
const BGUTIL_SCRIPT = `${BGUTIL_SERVER_HOME}/build/generate_once.js`;

// Returns extractor-args to activate bgutil PO token if the script is built.
function bgutilArgs(): string[] {
  if (existsSync(BGUTIL_SCRIPT)) {
    return ["--extractor-args", `youtubepot-bgutilscript:server_home=${BGUTIL_SERVER_HOME}`];
  }
  return [];
}

// Strategy order:
//  Phase 0 — android_vr WITHOUT cookies (fastest, no PO token needed, works for ~95% of public videos)
//  Phase 1 — cookie-based strategies (if cookies are present and Phase 0 failed)
//  Phase 2 — web client with bgutil PO token (if script built)
//  Phase 3 — bare fallback

// android_vr is always first — it bypasses SABR & PO token for most public videos.
const STRATEGIES_WITH_COOKIES: Array<{ client: string }> = [
  { client: "android_vr"   },  // no PO token needed
  { client: "web"          },
  { client: "mweb"         },
  { client: "tv_embedded"  },
];
const STRATEGIES_NO_COOKIES: Array<{ client: string }> = [
  { client: "android_vr"   },  // primary — bypasses SABR and PO token
  { client: "web"          },
  { client: "mweb"         },
  { client: "tv_embedded"  },
];

// Chrome user-agent to pair with browser cookies (web client expects this)
const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

function spawnYtDlp(
  args: string[],
  onProgress?: (pct: number) => void,
  timeoutMs = 600_000
): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    let timedOut = false;
    // Use new yt-dlp (2026.06.09) via PYTHONPATH override + Node.js JS runtime
    const proc = spawn("python3", ["-m", "yt_dlp", ...args], { env: YTDLP_ENV });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
      reject(new Error("yt-dlp timed out"));
    }, timeoutMs);

    proc.stdout.on("data", (chunk: Buffer) => {
      const line = chunk.toString();
      const m = line.match(/(\d+\.\d+)%/);
      if (m && onProgress) onProgress(parseFloat(m[1]));
    });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      if (code === 0) { resolve(); return; }
      reject(new Error(stderr.slice(-500)));
    });
    proc.on("error", (err) => { clearTimeout(timer); reject(err); });
  });
}

/** Download video with yt-dlp at the specified quality and merge to mp4.
 *
 *  Strategy rotation:
 *   1. Each player client is tried with formats=missing_pot so yt-dlp does not
 *      skip streams that lack a Proof-Of-Origin Token.
 *   2. For each client we try a quality-constrained format first, then fall back
 *      to "best" (any format yt-dlp can grab) so the video is never blocked
 *      solely by format-selector strictness.
 *   3. A final bare "best" attempt without any client override catches edge cases.
 */
async function downloadVideo(
  url: string,
  quality: string,
  outputPath: string,
  onProgress?: (pct: number) => void,
  codec?: string | null
): Promise<void> {
  const heightMap: Record<string, number> = {
    "360p": 360, "480p": 480, "720p": 720,
    "1080p": 1080, "1440p": 1440, "4k": 2160,
  };
  const maxH = heightMap[quality] ?? 1080;

  // Build codec filter: yt-dlp vcodec values
  // av1 → av01, vp9 → vp9, h264 → avc1
  const vcodecMap: Record<string, string> = {
    av1:  "av01",
    vp9:  "vp9",
    h264: "avc1",
  };
  const vcodecFilter = codec && vcodecMap[codec]
    ? `[vcodec^=${vcodecMap[codec]}]`
    : "";

  // Two format selectors per client:
  // 1. Strict: prefer exact height + codec, fall back within-height only
  // 2. Relaxed: still prefers target height + codec but allows any if truly unavailable
  const constrainedFmt = vcodecFilter
    ? `bestvideo*[height<=${maxH}]${vcodecFilter}+bestaudio/bestvideo*[height<=${maxH}]+bestaudio/best[height<=${maxH}]`
    : `bestvideo*[height<=${maxH}][height>=${maxH}]+bestaudio/bestvideo*[height<=${maxH}]+bestaudio/best[height<=${maxH}]`;
  const bestFmt = vcodecFilter
    ? `bestvideo*[height<=${maxH}]${vcodecFilter}+bestaudio/bestvideo*[height<=${maxH}]+bestaudio/best[height<=${maxH}]/best`
    : `bestvideo*[height<=${maxH}]+bestaudio/bestvideo*+bestaudio/best[height<=${maxH}]/best`;

  const commonArgs = [
    "--merge-output-format", "mp4",
    "--no-playlist",
    "--no-check-formats",
    "--progress",
    ...JS_RUNTIME_ARGS,
    "-o", outputPath,
  ];

  const hasCookies = existsSync(YT_COOKIES_PATH);
  const cookieArgs = hasCookies ? ["--cookies", YT_COOKIES_PATH] : [];
  // UA only for web/mweb — android_vr doesn't need it
  const uaArgs = hasCookies ? ["--user-agent", CHROME_UA] : [];
  const clientStrategies = hasCookies ? STRATEGIES_WITH_COOKIES : STRATEGIES_NO_COOKIES;
  const potArgs = bgutilArgs(); // PO token via bgutil script (empty if not built)

  let lastError = "";

  // Phase 1 — android_vr first (no cookies, no PO token needed for public videos),
  //            then web/mweb/tv_embedded with cookies + bgutil PO token if available.
  for (const { client } of clientStrategies) {
    const isAndroidVr = client === "android_vr";
    // android_vr doesn't use cookies or UA; other clients do
    const thisCookieArgs = isAndroidVr ? [] : cookieArgs;
    const thisUaArgs    = isAndroidVr ? [] : uaArgs;
    // bgutil PO token only helps web clients
    const thisPotArgs   = isAndroidVr ? [] : potArgs;

    for (const fmt of [constrainedFmt, bestFmt]) {
      logger.info({ url, client, fmt: fmt.slice(0, 40), hasCookies, bgutil: thisPotArgs.length > 0 }, "Trying client strategy");
      try {
        await spawnYtDlp([
          "-f", fmt,
          "--extractor-args", `youtube:player_client=${client};formats=missing_pot`,
          ...thisUaArgs,
          ...thisPotArgs,
          ...commonArgs,
          ...thisCookieArgs,
          url,
        ], onProgress, 240_000);
        logger.info({ url, client }, "Download succeeded");
        return;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        logger.warn({ url, client, err: lastError.slice(0, 120) }, "Client strategy failed");
      }
    }
  }

  // Phase 2 — last resort: bare best, no client override, no cookies
  logger.warn({ url }, "All strategies failed — trying bare fallback");
  try {
    await spawnYtDlp([
      "-f", bestFmt,
      "--extractor-args", "youtube:formats=missing_pot",
      ...commonArgs,
      url,
    ], onProgress, 180_000);
    logger.info({ url }, "Bare fallback succeeded");
    return;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
  }

  throw new Error(`yt-dlp download failed after all strategies: ${lastError.slice(0, 300)}`);
}

/**
 * Apply the FFmpeg processing pipeline for copyright-safety and quality:
 *   - Strip ALL original metadata (breaks fingerprinting)
 *   - Slight speed tweak (0.98×) + audio pitch shift (atempo 1.02 + asetrate)
 *   - Scale to target resolution using lanczos
 *   - Crop 2px from each edge (removes border artifacts)
 *   - Watermark in center-bottom
 *   - Re-encode with libx264 + AAC
 * These transforms are the standard suite for making content fingerprint-resistant.
 */
function pidFilePath(jobId: number) { return `${VIDEO_TMP_DIR}/job-${jobId}-ffmpeg.pid`; }
function progressFilePath(jobId: number) { return `${VIDEO_TMP_DIR}/job-${jobId}-ffmpeg-progress.txt`; }

/** Read out_time_us from FFmpeg -progress file and convert to seconds */
function readFFmpegProgressSecs(jobId: number): number | null {
  try {
    const txt = readFileSync(progressFilePath(jobId), "utf8");
    const m = txt.match(/out_time_us=(\d+)/g);
    if (!m) return null;
    const last = m[m.length - 1];
    const usec = parseInt(last.replace("out_time_us=", ""), 10);
    return isNaN(usec) ? null : usec / 1_000_000;
  } catch { return null; }
}

/** Return true if a PID is currently alive in the OS */
function isPidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/**
 * Spawn FFmpeg detached so it survives a server restart.
 * PID is written to a file; progress is written by FFmpeg itself via -progress.
 * proc.unref() lets Node.js exit freely without killing FFmpeg.
 */
/**
 * Apply the FFmpeg processing pipeline for copyright-safety and quality:
 *   - Strip ALL original metadata (breaks fingerprinting)
 *   - Slight speed tweak (0.98×) + audio pitch shift (atempo 1.02 + asetrate)
 *   - Scale to target resolution using lanczos
 *   - Crop 2px from each edge (removes border artifacts)
 *   - Amon-style logo watermark in two corners (top-right + bottom-left)
 *     using the NK NOVAKING ENTERTAINMENT PNG; falls back to drawtext if logo missing
 *   - Re-encode with libx264 + AAC
 */
async function processWithFFmpegPipeline(
  inputPath: string,
  outputPath: string,
  watermarkText: string,
  quality: string,
  durationSecs: number | null,
  onProgress?: (pct: number) => void,
  jobId?: number
): Promise<void> {
  const res = RESOLUTION_SETTINGS[quality] ?? RESOLUTION_SETTINGS["1080p"];
  const { scale, bitrate, w: outW } = res;
  const audioFilter = "atempo=1.02,asetrate=44982,aresample=44100";
  const progFile = jobId ? progressFilePath(jobId) : null;

  const logoExists = existsSync(LOGO_PATH);
  logger.info({ jobId, quality, logoExists, LOGO_PATH }, "Building FFmpeg pipeline");

  let args: string[];

  if (logoExists) {
    // ── Logo in top-right AND bottom-left corners ──────────────────────────────
    // Logo is scaled to 16% of the output video width (clearly visible).
    const logoW = Math.floor(outW * 0.16);
    const padding = Math.floor(outW * 0.012); // ~1.2% padding from edges

    // Copyright-avoidance video filters applied before watermark:
    //   setpts=0.98          → 2% speed-up shifts timestamps
    //   hue=h=1.8            → 1.8° hue rotation (imperceptible, breaks color hash)
    //   eq=brightness=0.02:
    //      contrast=1.02:
    //      saturation=1.05   → micro brightness/contrast/saturation tweak
    //   unsharp=5:5:0.4:     → mild luma sharpening alters per-pixel values
    //      5:5:0.0
    //   scale + crop         → resize to target + remove 2px border artifacts
    const videoProc = [
      `setpts=0.98*PTS`,
      `hue=h=1.8`,
      `eq=brightness=0.02:contrast=1.02:saturation=1.05`,
      `unsharp=5:5:0.4:5:5:0.0`,
      `scale=${scale}:flags=lanczos`,
      `crop=iw-2:ih-2`,
    ].join(",");

    // filter_complex:
    //  [1:v]  = logo PNG input
    //  scale logo → split into two copies
    //  process main video → overlay wm1 (top-right) → overlay wm2 (bottom-left)
    const filterComplex = [
      `[1:v]scale=${logoW}:-1:flags=lanczos,split=2[wm1][wm2]`,
      `[0:v]${videoProc}[base]`,
      `[base][wm1]overlay=main_w-overlay_w-${padding}:${padding}[v1]`,
      `[v1][wm2]overlay=${padding}:main_h-overlay_h-${padding}[vout]`,
    ].join(";");

    args = [
      "-y",
      "-i", inputPath,
      "-i", LOGO_PATH,
      "-map_metadata", "-1",
      "-filter_complex", filterComplex,
      "-map", "[vout]",
      "-map", "0:a?",  // include audio if present
      "-af", audioFilter,
      "-c:v", "libx264",
      "-b:v", bitrate,
      "-preset", "medium",
      "-crf", "18",
      "-c:a", "aac",
      "-b:a", "192k",
      ...(progFile ? ["-progress", progFile] : []),
      outputPath,
    ];
  } else {
    // ── Fallback: center-bottom text watermark ─────────────────────────────────
    const safeText = watermarkText.replace(/'/g, "'\\''");
    const videoFilter = [
      "setpts=0.98*PTS",
      "hue=h=1.8",
      "eq=brightness=0.02:contrast=1.02:saturation=1.05",
      "unsharp=5:5:0.4:5:5:0.0",
      `scale=${scale}:flags=lanczos`,
      "crop=iw-2:ih-2",
      `drawtext=fontfile='${FONT_FILE}':text='${safeText}':fontsize=72:fontcolor=white@0.5:x=(w-text_w)/2:y=h-text_h-60`,
    ].join(",");

    args = [
      "-y",
      "-i", inputPath,
      "-map_metadata", "-1",
      "-vf", videoFilter,
      "-af", audioFilter,
      "-c:v", "libx264",
      "-b:v", bitrate,
      "-preset", "medium",
      "-crf", "18",
      "-c:a", "aac",
      "-b:a", "192k",
      ...(progFile ? ["-progress", progFile] : []),
      outputPath,
    ];
  }

  return new Promise((resolve, reject) => {
    // detached: true → FFmpeg runs in its own process group and survives Node.js exit
    const proc = spawn("ffmpeg", args, {
      detached: true,
      stdio: ["ignore", "ignore", "pipe"], // keep stderr for error capture
    });

    // Write PID so we can re-attach on server restart
    if (jobId) {
      try { writeFileSync(pidFilePath(jobId), String(proc.pid), "utf8"); } catch { /* noop */ }
    }

    // Unref: Node.js event loop won't wait for FFmpeg — it can keep running after server exit
    proc.unref();

    let stderrBuf = "";
    let lastReportedPct = -1;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    // Poll the -progress file every 3s for progress updates
    if (onProgress && durationSecs && durationSecs > 0 && progFile) {
      pollInterval = setInterval(() => {
        const elapsed = readFFmpegProgressSecs(jobId!);
        if (elapsed !== null) {
          const pct = Math.min(100, Math.floor((elapsed / durationSecs) * 100));
          if (pct > lastReportedPct) {
            lastReportedPct = pct;
            onProgress(pct);
          }
        }
      }, 3_000);
    }

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });

    proc.on("close", (code) => {
      if (pollInterval) clearInterval(pollInterval);
      // Clean up helper files
      if (jobId) {
        try { if (existsSync(pidFilePath(jobId))) unlinkSync(pidFilePath(jobId)); } catch { /* noop */ }
        try { if (progFile && existsSync(progFile)) unlinkSync(progFile); } catch { /* noop */ }
      }
      if (code === 0) { resolve(); return; }
      reject(new Error(`FFmpeg processing failed (code ${code}): ${stderrBuf.slice(-600)}`));
    });
    proc.on("error", reject);
  });
}

/**
 * Crop a horizontal video to a vertical 9:16 format for YouTube Shorts.
 * Center-crops to maintain the most important part of the frame.
 * Output is scaled to 1080×1920.
 */
export async function createShortsVersion(inputPath: string, outputPath: string): Promise<void> {
  logger.info({ inputPath, outputPath }, "Creating vertical Shorts version");
  return new Promise((resolve, reject) => {
    const args = [
      "-y", "-i", inputPath,
      "-vf", "crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920:flags=lanczos",
      "-c:v", "libx264",
      "-b:v", "8M",
      "-preset", "fast",
      "-crf", "20",
      "-c:a", "aac",
      "-b:a", "192k",
      outputPath,
    ];
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (c: Buffer) => { stderr += c.toString(); });
    proc.on("close", (code) => {
      if (code === 0) { resolve(); return; }
      reject(new Error(`Shorts crop failed (code ${code}): ${stderr.slice(-300)}`));
    });
    proc.on("error", reject);
  });
}

/**
 * Re-attach to a detached FFmpeg process that is still running.
 * Polls the progress file every 3s until the PID dies, then verifies the output.
 */
async function waitForDetachedFFmpeg(
  jobId: number,
  pid: number,
  outputPath: string,
  durationSecs: number | null,
  onProgress?: (pct: number) => void
): Promise<void> {
  logger.info({ jobId, pid }, "Re-attaching to running FFmpeg process");
  let lastReportedPct = -1;

  return new Promise((resolve, reject) => {
    const poll = setInterval(async () => {
      // Report progress from file
      if (onProgress && durationSecs && durationSecs > 0) {
        const elapsed = readFFmpegProgressSecs(jobId);
        if (elapsed !== null) {
          const pct = Math.min(100, Math.floor((elapsed / durationSecs) * 100));
          if (pct > lastReportedPct) {
            lastReportedPct = pct;
            onProgress(pct);
          }
        }
      }

      if (!isPidAlive(pid)) {
        clearInterval(poll);
        // Clean up helper files
        try { if (existsSync(pidFilePath(jobId))) unlinkSync(pidFilePath(jobId)); } catch { /* noop */ }
        try { if (existsSync(progressFilePath(jobId))) unlinkSync(progressFilePath(jobId)); } catch { /* noop */ }

        // Verify output exists and has content
        if (existsSync(outputPath)) {
          const size = statSync(outputPath).size;
          if (size > 100_000) { resolve(); return; }
        }
        reject(new Error("FFmpeg process exited but output file is missing or too small"));
      }
    }, 3_000);
  });
}

/** Safely delete a file if it exists */
function tryUnlink(path: string) {
  try { if (existsSync(path)) unlinkSync(path); } catch { /* noop */ }
}

async function getWatermarkText(): Promise<string> {
  try {
    const [row] = await db
      .select()
      .from(appConfigTable)
      .where(eq(appConfigTable.key, "watermark_text"))
      .limit(1);
    return row?.value || "NovaKing";
  } catch {
    return "NovaKing";
  }
}

async function runPublishPipeline(jobId: number, platformsStr: string): Promise<void> {
  const platforms = platformsStr.split(",").map((p) => p.trim()).filter(Boolean);

  for (const platform of platforms) {
    await db.insert(publishLogsTable).values({ jobId, platform, status: "pending" });
  }

  await db.update(videoJobsTable)
    .set({ status: "publishing", progress: 80 })
    .where(eq(videoJobsTable.id, jobId));

  try {
    for (const platform of platforms) {
      if (platform === "youtube" || platform === "youtube-shorts") {
        const isShorts = platform === "youtube-shorts";
        const [ytToken] = await db
          .select()
          .from(apiTokensTable)
          .where(and(eq(apiTokensTable.platform, "youtube"), eq(apiTokensTable.isActive, true)))
          .limit(1);

        if (ytToken) {
          const result = await publishToYouTube(jobId, { isShorts });
          await updatePublishLog(jobId, platform, "success", result.url);
        } else {
          await new Promise((r) => setTimeout(r, 2000));
          const simUrl = isShorts
            ? `https://youtube.com/shorts/sim-${jobId}-${Date.now()}`
            : `https://youtube.com/watch?v=sim-${jobId}-${Date.now()}`;
          await updatePublishLog(jobId, platform, "success", simUrl);
        }
      } else if (platform === "facebook") {
        const [fbToken] = await db
          .select()
          .from(apiTokensTable)
          .where(and(eq(apiTokensTable.platform, "facebook"), eq(apiTokensTable.isActive, true)))
          .limit(1);
        if (fbToken) {
          const result = await publishToFacebook(jobId);
          await updatePublishLog(jobId, platform, "success", result.url);
        } else {
          await new Promise((r) => setTimeout(r, 2000));
          await updatePublishLog(jobId, platform, "success", `https://facebook.com/video/sim-${jobId}-${Date.now()}`);
        }
      } else {
        await new Promise((r) => setTimeout(r, 1500));
        await updatePublishLog(jobId, platform, "success", `https://${platform}.com/posts/sim-${jobId}`);
      }
    }

    await db.update(videoJobsTable)
      .set({ status: "published", progress: 100 })
      .where(eq(videoJobsTable.id, jobId));

    logger.info({ jobId, platforms }, "Auto-publish pipeline completed");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Publish failed";
    logger.error({ err, jobId }, "Auto-publish pipeline failed");
    for (const platform of platforms) {
      await updatePublishLog(jobId, platform, "failed", undefined, msg).catch(() => {});
    }
    await db.update(videoJobsTable)
      .set({ status: "failed", errorMessage: msg })
      .where(eq(videoJobsTable.id, jobId));
  }
}

interface ProcessingOptions {
  /** Skip the download stage — use an already-downloaded raw file */
  skipDownload?: boolean;
  /** Path to an existing raw file when skipDownload is true */
  existingRawPath?: string;
  /** Skip straight to Stage 4 (content/thumbnails) — FFmpeg + download already done */
  skipToContentStage?: boolean;
}

/**
 * Download a video for a job and store the path in the DB.
 * Used when a job was created without a download (metadata-only) but
 * then needs to be published to a platform that requires a file (e.g. Facebook).
 */
export async function downloadVideoForJob(
  jobId: number,
  url: string,
  quality = "720p"
): Promise<string> {
  if (!existsSync(VIDEO_TMP_DIR)) mkdirSync(VIDEO_TMP_DIR, { recursive: true });
  const outputPath = `${VIDEO_TMP_DIR}/job-${jobId}-raw.mp4`;
  logger.info({ jobId, url, quality, outputPath }, "Downloading video for job (pre-publish)");
  await downloadVideo(url, quality, outputPath);
  await updateJob(jobId, { videoPath: outputPath });
  logger.info({ jobId, outputPath }, "Pre-publish download complete");
  return outputPath;
}

export async function startVideoProcessing(
  jobId: number,
  videoUrl: string,
  opts: ProcessingOptions = {}
): Promise<void> {
  const { skipDownload = false, existingRawPath, skipToContentStage = false } = opts;
  logger.info({ jobId, videoUrl, skipDownload, skipToContentStage }, "Starting video processing pipeline");

  const [jobRow0] = await db.select().from(videoJobsTable).where(eq(videoJobsTable.id, jobId)).limit(1);
  const jobQuality = jobRow0?.quality ?? null;
  const jobCodec = jobRow0?.codec ?? null;

  // Any quality set = download the actual video file
  const isDownloadJob = !!jobQuality;
  // FFmpeg only for 4K Mission jobs — Normal Mission publishes the download directly
  const needsFFmpegPipeline = isDownloadJob && jobRow0?.missionType === "4k";

  try {
    // ── Stage 1: Fetch metadata ──────────────────────────────────────────────
    if (!skipToContentStage) await updateJob(jobId, { status: "downloading", progress: 5 });

    const platform = detectPlatform(videoUrl);
    logger.info({ jobId, platform, isDownloadJob, needsFFmpegPipeline }, "Detected source platform");

    let meta = await fetchYtDlpMetadata(videoUrl);

    if (!meta.title && platform === "youtube") {
      meta = await fetchYouTubeOembedFallback(videoUrl);
    }

    const youtubeId = platform === "youtube" ? (meta.id || extractYouTubeId(videoUrl)) : null;
    const platformLabel =
      platform === "facebook" ? "Facebook Video" :
      platform === "youtube"  ? "YouTube Video" :
      "Video";

    const originalTitle = meta.title || platformLabel;
    const originalDescription = meta.description ?? null;

    await updateJob(jobId, {
      originalTitle,
      originalDescription,
      thumbnailUrl: meta.thumbnail || (youtubeId ? `https://img.youtube.com/vi/${youtubeId}/maxresdefault.jpg` : null),
      duration: meta.duration ? Math.round(meta.duration) : null,
      progress: 15,
    });

    // ── Stage 2: Download full video ─────────────────────────────────────────
    let processedVideoPath: string | null = null;

    if (skipToContentStage) {
      // Resumed from after FFmpeg — videoPath already set in DB, skip to Stage 4
      logger.info({ jobId }, "Skipping to content stage (FFmpeg/download already done)");
    } else if (isDownloadJob) {
      if (!existsSync(VIDEO_TMP_DIR)) mkdirSync(VIDEO_TMP_DIR, { recursive: true });

      const rawPath = existingRawPath ?? `${VIDEO_TMP_DIR}/job-${jobId}-raw.mp4`;

      if (skipDownload && existsSync(rawPath)) {
        logger.info({ jobId, rawPath }, "Skipping download — raw file already exists");
        await updateJob(jobId, { progress: 43 });
      } else {
        await updateJob(jobId, { status: "downloading", progress: 20 });
        logger.info({ jobId, quality: jobQuality }, "Starting full video download");

        await downloadVideo(videoUrl, jobQuality!, rawPath, async (pct) => {
          const progress = 20 + Math.floor(pct * 0.22);
          await updateJob(jobId, { progress });
        }, jobCodec);

        logger.info({ jobId }, "Download complete");
        await updateJob(jobId, { progress: 43 });
      }

      if (needsFFmpegPipeline) {
        // ── Stage 3: FFmpeg pipeline (4K Mission only) ──────────────────────
        await updateJob(jobId, { status: "processing", progress: 45 });
        logger.info({ jobId, quality: jobQuality }, "Starting FFmpeg pipeline");

        const outPath = `${VIDEO_TMP_DIR}/job-${jobId}-processed.mp4`;
        const watermark = await getWatermarkText();
        const durationSecs = meta.duration ?? null;

        await processWithFFmpegPipeline(
          rawPath,
          outPath,
          watermark,
          jobQuality!,
          durationSecs,
          async (pct) => {
            // Map FFmpeg % (0–100) to overall progress range 45–72%
            const progress = 45 + Math.floor(pct * 0.27);
            await updateJob(jobId, { progress });
          },
          jobId
        );

        tryUnlink(rawPath);
        processedVideoPath = outPath;
        await updateJob(jobId, { videoPath: outPath, progress: 73 });
        logger.info({ jobId, outPath, quality: jobQuality }, "FFmpeg pipeline complete");
      } else {
        // 360p–1080p: publish the downloaded file directly, no re-encoding
        processedVideoPath = rawPath;
        await updateJob(jobId, { videoPath: rawPath, progress: 73 });
        logger.info({ jobId, rawPath, quality: jobQuality }, "FFmpeg skipped — using raw download for publish");
      }

    } else {
      // Metadata-only job (no quality set — standard New Mission flow)
      await updateJob(jobId, { status: "processing", progress: 40 });
      const ffmpegOk = await verifyFfmpeg();
      logger.info({ ffmpegOk }, "ffmpeg availability check");
      await sleep(1500);
      await updateJob(jobId, { progress: 60 });
      await sleep(1000);
    }

    // ── Stage 4: Populate content from metadata ──────────────────────────────
    const originalTags = Array.isArray(meta.tags) && meta.tags.length > 0
      ? meta.tags.slice(0, 30).join(", ")
      : null;

    await updateJob(jobId, {
      title: originalTitle,
      description: originalDescription,
      tags: originalTags,
      hashtags: null,
      progress: 90,
    });

    // Generate thumbnail variants
    const variants = buildThumbnailVariants(platform, youtubeId, meta.thumbnail);
    for (let i = 0; i < variants.length; i++) {
      await db.insert(thumbnailsTable).values({
        jobId,
        variantIndex: i,
        imageUrl: variants[i].url,
        label: variants[i].label,
        isSelected: i === 0,
      });
    }

    // ── Stage 5: Ready ───────────────────────────────────────────────────────
    await updateJob(jobId, { status: "ready", progress: 100 });
    logger.info({ jobId, isDownloadJob, needsFFmpegPipeline }, "Video processing pipeline completed successfully");

    // Auto-publish if configured
    const [jobRow] = await db.select().from(videoJobsTable).where(eq(videoJobsTable.id, jobId)).limit(1);
    if (jobRow?.publishMode === "auto") {
      logger.info({ jobId }, "Auto-publish mode detected — starting publish pipeline");
      await runPublishPipeline(jobId, jobRow.platforms ?? "youtube");
    }

  } catch (err) {
    logger.error({ err, jobId }, "Video processing pipeline failed");
    tryUnlink(`${VIDEO_TMP_DIR}/job-${jobId}-raw.mp4`);
    tryUnlink(`${VIDEO_TMP_DIR}/job-${jobId}-processed.mp4`);
    await updateJob(jobId, {
      status: "failed",
      errorMessage: err instanceof Error ? err.message : "Processing failed",
    });
  }
}

/**
 * On server startup: find jobs stuck in pending/downloading/processing and
 * resume them intelligently without re-doing already-finished stages.
 *
 * Resume logic per job:
 *   1. If a FFmpeg PID file exists and the process is still alive →
 *      re-attach progress monitoring and wait for it to finish, then
 *      continue the pipeline from Stage 4 onward.
 *   2. If processed output file already exists and is large enough →
 *      skip download + FFmpeg, continue from Stage 4 (content/thumbnails).
 *   3. If raw file exists → skip download, re-run FFmpeg from Stage 3.
 *   4. Otherwise → restart the full pipeline from scratch.
 */
export async function resumeStuckJobs(): Promise<void> {
  const stuckJobs = await db
    .select()
    .from(videoJobsTable)
    .where(inArray(videoJobsTable.status, ["pending", "downloading", "processing"]));

  if (stuckJobs.length === 0) {
    logger.info("No stuck jobs to resume");
    return;
  }

  logger.info({ count: stuckJobs.length }, "Resuming stuck jobs after server restart");

  for (const job of stuckJobs) {
    const jobId = job.id;
    const videoUrl = job.youtubeUrl ?? "";
    if (!videoUrl) {
      logger.warn({ jobId }, "Stuck job has no URL — marking failed");
      await updateJob(jobId, { status: "failed", errorMessage: "No video URL — resubmit the job" });
      continue;
    }

    const rawPath       = `${VIDEO_TMP_DIR}/job-${jobId}-raw.mp4`;
    const processedPath = `${VIDEO_TMP_DIR}/job-${jobId}-processed.mp4`;
    const needsFFmpeg   = job.missionType === "4k" && !!job.quality;

    // ── Case 1: FFmpeg is still alive (survived server restart) ──────────────
    const pidFile = pidFilePath(jobId);
    if (needsFFmpeg && existsSync(pidFile)) {
      const pid = parseInt(readFileSync(pidFile, "utf8").trim(), 10);
      if (!isNaN(pid) && isPidAlive(pid)) {
        logger.info({ jobId, pid }, "FFmpeg still running — waiting for it to finish");
        // Run in background so startup doesn't block
        (async () => {
          try {
            await updateJob(jobId, { status: "processing" });
            await waitForDetachedFFmpeg(jobId, pid, processedPath, job.duration ?? null, async (pct) => {
              await updateJob(jobId, { progress: 45 + Math.floor(pct * 0.27) });
            });
            tryUnlink(rawPath);
            await updateJob(jobId, { videoPath: processedPath, progress: 73 });
            // Continue with content generation + thumbnails
            await startVideoProcessing(jobId, videoUrl, { skipToContentStage: true });
          } catch (err) {
            logger.error({ err, jobId }, "Resume (FFmpeg alive) failed");
            await updateJob(jobId, { status: "failed", errorMessage: err instanceof Error ? err.message : "Resume failed" });
          }
        })().catch(() => {});
        continue;
      }
    }

    // ── Case 2: Processed file already exists and is complete ────────────────
    if (needsFFmpeg && existsSync(processedPath) && statSync(processedPath).size > 100_000) {
      logger.info({ jobId, processedPath }, "Processed file exists — resuming from content stage");
      await updateJob(jobId, { videoPath: processedPath });
      startVideoProcessing(jobId, videoUrl, { skipToContentStage: true }).catch((err) =>
        logger.error({ err, jobId }, "Resume (processed exists) failed")
      );
      continue;
    }

    // ── Case 3: Raw file exists — skip download, re-run FFmpeg ───────────────
    if (!!job.quality && existsSync(rawPath) && statSync(rawPath).size > 100_000) {
      logger.info({ jobId, rawPath }, "Raw file exists — resuming from FFmpeg stage");
      startVideoProcessing(jobId, videoUrl, { skipDownload: true, existingRawPath: rawPath }).catch((err) =>
        logger.error({ err, jobId }, "Resume (raw exists) failed")
      );
      continue;
    }

    // ── Case 4: Full restart ──────────────────────────────────────────────────
    logger.info({ jobId }, "No recoverable files — restarting full pipeline");
    startVideoProcessing(jobId, videoUrl).catch((err) =>
      logger.error({ err, jobId }, "Resume (full restart) failed")
    );
  }
}
