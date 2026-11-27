import { readFileSync, existsSync } from "fs";
import * as os from "os";

const RESERVED_DISK_MB = 250;
const MIN_FREE_MB_FOR_4K = 850;
const MIN_SAFE_MAX_FILESIZE_MB = 120;

export interface FormatSizeCandidate {
  width?: number;
  height?: number;
  filesize?: number;
  filesize_approx?: number;
  vcodec?: string;
  acodec?: string;
  tbr?: number;
}

export interface SizeEstimatableMeta {
  duration?: number;
  formats?: FormatSizeCandidate[];
}

export function detectContainerMemoryMB(): number {
  const cgroupFiles = [
    "/sys/fs/cgroup/memory.max",
    "/sys/fs/cgroup/memory/memory.limit_in_bytes",
  ];
  for (const file of cgroupFiles) {
    try {
      if (!existsSync(file)) continue;
      const raw = readFileSync(file, "utf8").trim();
      if (!raw || raw === "max") continue;
      const bytes = Number(raw);
      if (!Number.isNaN(bytes) && bytes > 0 && bytes < 64 * 1024 * 1024 * 1024) {
        return Math.round(bytes / (1024 * 1024));
      }
    } catch {
      // fall through
    }
  }
  return Math.round(os.totalmem() / (1024 * 1024));
}

export function isLowRamMode(): boolean {
  if (process.env.FFMPEG_LOW_RAM === "false") return false;
  if (process.env.FFMPEG_LOW_RAM === "true") return true;
  return detectContainerMemoryMB() <= 1536;
}

export interface LowRamFfmpegOptions {
  lowRam: boolean;
  threadsArgs: string[];
  preset: string;
  x264Params: string;
  scaleFlags: "bilinear" | "lanczos";
  maxMuxingQueueSize: string;
}

export function getLowRamFfmpegOptions(lowRam = isLowRamMode()): LowRamFfmpegOptions {
  if (lowRam) {
    return {
      lowRam: true,
      threadsArgs: ["-threads", "1"],
      preset: "superfast",
      x264Params: "rc-lookahead=8:ref=1:bframes=0:sync-lookahead=0:weightp=0",
      scaleFlags: "bilinear",
      maxMuxingQueueSize: "512",
    };
  }
  return {
    lowRam: false,
    threadsArgs: ["-threads", "2"],
    preset: "veryfast",
    x264Params: "rc-lookahead=16:ref=2",
    scaleFlags: "lanczos",
    maxMuxingQueueSize: "1024",
  };
}

const QUALITY_TARGET_HEIGHT: Record<string, number> = {
  "360p": 360,
  "480p": 480,
  "720p": 720,
  "1080p": 1080,
  "1440p": 1440,
  "4k": 2160,
};

function estimateFormatBytes(fmt: FormatSizeCandidate, durationSecs?: number): number {
  if (typeof fmt.filesize === "number" && fmt.filesize > 0) return fmt.filesize;
  if (typeof fmt.filesize_approx === "number" && fmt.filesize_approx > 0) {
    return fmt.filesize_approx;
  }
  if (typeof fmt.tbr === "number" && fmt.tbr > 0 && typeof durationSecs === "number" && durationSecs > 0) {
    return (fmt.tbr * 1000 * durationSecs) / 8;
  }
  return 0;
}

export function estimateYtDlpSizeMB(
  meta: SizeEstimatableMeta | null | undefined,
  quality?: string | null
): number | null {
  if (!meta) return null;
  const formats = Array.isArray(meta.formats) ? meta.formats : [];
  const targetH = quality ? (QUALITY_TARGET_HEIGHT[quality.toLowerCase()] ?? 1080) : 1080;
  const durationSecs = typeof meta.duration === "number" && meta.duration > 0 ? meta.duration : undefined;

  if (formats.length === 0) {
    if (!durationSecs) return null;
    // Conservative fallback bitrate estimate when format list is omitted
    const mbps = targetH >= 2160 ? 22 : targetH >= 1440 ? 10 : targetH >= 1080 ? 4.5 : 2.2;
    return Math.ceil((mbps * 1_000_000 * durationSecs) / 8 / (1024 * 1024));
  }

  const videoFormats = formats.filter((f) => {
    if (!f.vcodec || f.vcodec === "none") return false;
    const minDim =
      typeof f.width === "number" && typeof f.height === "number" && f.width > 0 && f.height > 0
        ? Math.min(f.width, f.height)
        : f.height ?? 0;
    if (minDim <= 0) return false;
    return targetH >= 2160 ? minDim >= 2160 : minDim <= targetH;
  });

  let bestVideoBytes = 0;
  let videoHasAudio = false;
  for (const vf of videoFormats) {
    const bytes = estimateFormatBytes(vf, durationSecs);
    if (bytes > bestVideoBytes) {
      bestVideoBytes = bytes;
      videoHasAudio = Boolean(vf.acodec && vf.acodec !== "none");
    }
  }

  let bestAudioBytes = 0;
  if (!videoHasAudio) {
    for (const af of formats) {
      if (af.vcodec && af.vcodec !== "none") continue;
      if (!af.acodec || af.acodec === "none") continue;
      const bytes = estimateFormatBytes(af, durationSecs);
      if (bytes > bestAudioBytes) {
        bestAudioBytes = bytes;
      }
    }
  }

  const totalBytes = bestVideoBytes + bestAudioBytes;
  if (totalBytes <= 0) return null;
  return Math.ceil(totalBytes / (1024 * 1024));
}

export interface DiskQualityPlan {
  effectiveQuality: string | null;
  downgradedFrom4K: boolean;
  reason: string | null;
  maxFilesizeMB: number | null;
}

export function planQualityForDiskSpace(params: {
  requestedQuality: string | null | undefined;
  needsFfmpeg: boolean;
  availableMB: number | null;
  estimatedSourceMB: number | null;
}): DiskQualityPlan {
  const { requestedQuality, needsFfmpeg, availableMB, estimatedSourceMB } = params;
  const peakMultiplier = needsFfmpeg ? 2.15 : 1.25;
  const usableMB = availableMB !== null ? Math.max(0, availableMB - RESERVED_DISK_MB) : null;
  const maxFilesizeMB =
    usableMB !== null ? Math.max(MIN_SAFE_MAX_FILESIZE_MB, Math.floor(usableMB / peakMultiplier)) : null;

  const is4k = requestedQuality?.toLowerCase() === "4k";
  if (is4k && availableMB !== null) {
    if (availableMB < MIN_FREE_MB_FOR_4K) {
      return {
        effectiveQuality: "1080p",
        downgradedFrom4K: true,
        reason: `Free temp disk (${availableMB} MB) is below ${MIN_FREE_MB_FOR_4K} MB required for safe 4K processing — auto-downgraded to 1080p.`,
        maxFilesizeMB,
      };
    }

    if (estimatedSourceMB !== null && usableMB !== null && estimatedSourceMB * peakMultiplier > usableMB) {
      const needMB = Math.ceil(estimatedSourceMB * peakMultiplier);
      return {
        effectiveQuality: "1080p",
        downgradedFrom4K: true,
        reason: `Estimated 4K peak temp space (~${needMB} MB) exceeds safe free temp disk (${usableMB} MB usable) — auto-downgraded to 1080p.`,
        maxFilesizeMB,
      };
    }
  }

  return {
    effectiveQuality: requestedQuality ?? null,
    downgradedFrom4K: false,
    reason: null,
    maxFilesizeMB,
  };
}

// ── Strict Single-Job Serial Processing Queue ────────────────────────────────

interface QueueWaiter {
  jobId: number;
  resolve: (release: () => void) => void;
  reject: (err: Error) => void;
  cleanup: () => void;
}

let activeSlotJobId: number | null = null;
const slotWaiters: QueueWaiter[] = [];

export function getProcessingQueueInfo(): {
  activeJobId: number | null;
  queuedJobIds: number[];
} {
  return {
    activeJobId: activeSlotJobId,
    queuedJobIds: slotWaiters.map((w) => w.jobId),
  };
}

function makeReleaseFn(jobId: number): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (activeSlotJobId !== jobId) return;

    activeSlotJobId = null;
    while (slotWaiters.length > 0) {
      const next = slotWaiters.shift()!;
      next.cleanup();
      activeSlotJobId = next.jobId;
      next.resolve(makeReleaseFn(next.jobId));
      return;
    }
  };
}

export function acquireProcessingSlot(
  jobId: number,
  signal?: AbortSignal
): Promise<() => void> {
  if (signal?.aborted) {
    return Promise.reject(new Error("[CANCELLED] Stopped by user"));
  }

  if (activeSlotJobId === null) {
    activeSlotJobId = jobId;
    return Promise.resolve(makeReleaseFn(jobId));
  }

  return new Promise<() => void>((resolve, reject) => {
    const waiter: QueueWaiter = {
      jobId,
      resolve,
      reject,
      cleanup: () => {
        signal?.removeEventListener("abort", onAbort);
      },
    };

    const onAbort = () => {
      const idx = slotWaiters.indexOf(waiter);
      if (idx >= 0) slotWaiters.splice(idx, 1);
      waiter.cleanup();
      reject(new Error("[CANCELLED] Stopped by user"));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    slotWaiters.push(waiter);
  });
}
