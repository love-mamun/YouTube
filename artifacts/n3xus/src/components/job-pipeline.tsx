import { cn } from "@/lib/utils";
import { CheckCircle2, Download, Clapperboard, Upload } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

type VideoJobStatus =
  | "pending" | "downloading" | "processing" | "generating"
  | "ready" | "approved" | "publishing" | "published" | "failed";

const PIPELINE_STEPS = [
  { id: "pending",     label: "Init",     short: "INIT" },
  { id: "downloading", label: "Download", short: "DL"   },
  { id: "processing",  label: "Process",  short: "PROC" },
  { id: "ready",       label: "Ready",    short: "RDY"  },
  { id: "approved",    label: "Approved", short: "APPR" },
  { id: "publishing",  label: "Publish",  short: "PUB"  },
  { id: "published",   label: "Done",     short: "DONE" },
];

/** Maps overall job progress (0-100) to a per-stage sub-percentage */
function computeSubProgress(status: string, progress: number): number {
  switch (status) {
    case "downloading":
      // download spans overall progress 20-42
      return Math.round(Math.min(100, Math.max(0, ((progress - 20) / 22) * 100)));
    case "processing":
      // ffmpeg spans overall progress 45-72
      return Math.round(Math.min(100, Math.max(0, ((progress - 45) / 27) * 100)));
    case "generating":
      // AI gen spans overall progress 75-88
      return Math.round(Math.min(100, Math.max(0, ((progress - 75) / 13) * 100)));
    case "publishing":
      // publish spans overall progress 80-100
      return Math.round(Math.min(100, Math.max(0, ((progress - 80) / 20) * 100)));
    default:
      return progress;
  }
}

const STAGE_CONFIG: Record<string, {
  icon: React.ReactNode;
  label: string;
  sublabel: string;
  color: string;
  barColor: string;
  glowColor: string;
  scanColor: string;
}> = {
  downloading: {
    icon: <Download className="w-3.5 h-3.5" />,
    label: "DOWNLOADING VIDEO",
    sublabel: "Fetching from YouTube CDN via yt-dlp",
    color: "text-cyan-400",
    barColor: "bg-cyan-400",
    glowColor: "shadow-[0_0_12px_rgba(0,212,255,0.6)]",
    scanColor: "from-cyan-400/0 via-cyan-200/60 to-cyan-400/0",
  },
  processing: {
    icon: <Clapperboard className="w-3.5 h-3.5" />,
    label: "ENCODING VIDEO",
    sublabel: "FFmpeg pipeline — re-encoding & watermarking",
    color: "text-amber-400",
    barColor: "bg-amber-400",
    glowColor: "shadow-[0_0_12px_rgba(251,191,36,0.5)]",
    scanColor: "from-amber-400/0 via-amber-200/60 to-amber-400/0",
  },
  publishing: {
    icon: <Upload className="w-3.5 h-3.5" />,
    label: "UPLOADING TO PLATFORMS",
    sublabel: "Pushing video to YouTube / Facebook",
    color: "text-green-400",
    barColor: "bg-green-400",
    glowColor: "shadow-[0_0_12px_rgba(74,222,128,0.5)]",
    scanColor: "from-green-400/0 via-green-200/60 to-green-400/0",
  },
};

function StageProgressPanel({ status, progress }: { status: string; progress: number }) {
  const baseCfg = STAGE_CONFIG[status];
  if (!baseCfg) return null;

  const isPreparingPublish = status === "publishing" && progress < 89;
  const cfg = isPreparingPublish
    ? {
        ...baseCfg,
        icon: <Download className="w-3.5 h-3.5" />,
        label: "PREPARING VIDEO FOR UPLOAD",
        sublabel: "Downloading source video before platform upload",
      }
    : baseCfg;

  const subPct = computeSubProgress(status, progress);
  const isIndeterminate = status === "generating" && subPct < 5;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={status}
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 6 }}
        transition={{ duration: 0.25 }}
        className="mt-4 rounded-lg border border-border/60 bg-card/60 backdrop-blur-sm overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/40">
          <div className={cn("flex items-center gap-2 font-mono text-[11px] font-bold tracking-widest", cfg.color)}>
            <span className="animate-pulse">◉</span>
            {cfg.icon}
            {cfg.label}
          </div>
          <span className={cn("font-mono text-lg font-black tabular-nums", cfg.color)}>
            {isIndeterminate ? "—" : `${subPct}%`}
          </span>
        </div>

        {/* Progress bar */}
        <div className="px-4 py-3 space-y-2">
          <div className="relative w-full h-2.5 bg-muted/60 rounded-full overflow-hidden">
            {/* Filled track */}
            <motion.div
              className={cn("absolute left-0 top-0 bottom-0 rounded-full", cfg.barColor, cfg.glowColor)}
              initial={{ width: 0 }}
              animate={{ width: isIndeterminate ? "100%" : `${subPct}%` }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              style={isIndeterminate ? { opacity: 0.3 } : {}}
            />

            {/* Animated scan line */}
            {(subPct < 100) && (
              <motion.div
                className={cn("absolute top-0 bottom-0 w-16 bg-gradient-to-r pointer-events-none", cfg.scanColor)}
                animate={{ x: isIndeterminate ? ["0%", "600%"] : [`${Math.max(0, subPct - 8)}%`, `${subPct + 2}%`] }}
                transition={
                  isIndeterminate
                    ? { duration: 1.4, repeat: Infinity, ease: "easeInOut" }
                    : { duration: 0.6, repeat: Infinity, repeatType: "reverse", ease: "easeInOut" }
                }
              />
            )}

            {/* Completion flash */}
            {subPct >= 100 && (
              <motion.div
                className="absolute inset-0 bg-white/20 rounded-full"
                initial={{ opacity: 1 }}
                animate={{ opacity: 0 }}
                transition={{ duration: 0.6 }}
              />
            )}
          </div>

          {/* Tick marks */}
          <div className="flex justify-between px-0.5">
            {[0, 25, 50, 75, 100].map((tick) => (
              <span
                key={tick}
                className={cn(
                  "font-mono text-[9px] tabular-nums",
                  subPct >= tick ? cfg.color + "/70" : "text-muted-foreground/30"
                )}
              >
                {tick}
              </span>
            ))}
          </div>

          {/* Sublabel + block progress */}
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] text-muted-foreground">{cfg.sublabel}</span>
            <span className="font-mono text-[10px] text-muted-foreground/50 tabular-nums">
              {isIndeterminate ? "calculating…" : `${subPct} / 100`}
            </span>
          </div>

          {/* Block-style progress (terminal aesthetic) */}
          <div className="font-mono text-[11px] flex items-center gap-1 overflow-hidden">
            <span className={cfg.color + "/40"}>{"["}</span>
            <span className={cfg.color}>
              {isIndeterminate
                ? "░".repeat(20)
                : "█".repeat(Math.floor(subPct / 5)) + "░".repeat(20 - Math.floor(subPct / 5))}
            </span>
            <span className={cfg.color + "/40"}>]</span>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

export function JobPipeline({
  currentStatus,
  progress = 0,
}: {
  currentStatus: string;
  progress?: number;
}) {
  if (currentStatus === "failed") {
    return (
      <div className="w-full bg-destructive/10 border border-destructive/30 rounded p-4 text-destructive font-mono text-sm flex items-center gap-3">
        <div className="w-2 h-2 rounded-full bg-destructive animate-pulse shrink-0" />
        MISSION FAILED. SYSTEM HALTED.
      </div>
    );
  }

  const currentIndex = PIPELINE_STEPS.findIndex((s) => s.id === currentStatus);
  const isDone = currentStatus === "published";
  const isActive = ["downloading", "processing", "publishing"].includes(currentStatus);

  return (
    <div className="w-full space-y-3">
      {/* Step indicators */}
      <div className="overflow-x-auto -mx-1 px-1">
        <div className="flex items-center min-w-max gap-1.5 sm:gap-0 sm:justify-between sm:min-w-0 sm:w-full">
          {PIPELINE_STEPS.map((step, index) => {
            const isCompleted = index < currentIndex || isDone;
            const isStepActive = index === currentIndex && !isDone;
            const isLast = index === PIPELINE_STEPS.length - 1;

            return (
              <div key={step.id} className="flex items-center sm:flex-1 sm:last:flex-none">
                <div className="flex flex-col items-center gap-1">
                  <div
                    className={cn(
                      "w-8 h-8 rounded-md flex items-center justify-center transition-all duration-300 shrink-0",
                      isCompleted
                        ? "bg-primary text-primary-foreground shadow-[0_0_10px_hsl(var(--primary)/0.5)]"
                        : isStepActive
                        ? "bg-primary/20 text-primary border border-primary/60 shadow-[0_0_6px_hsl(var(--primary)/0.3)]"
                        : "bg-muted text-muted-foreground border border-border"
                    )}
                  >
                    {isCompleted ? (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    ) : (
                      <span className="font-mono text-[9px] font-bold">{step.short}</span>
                    )}
                  </div>
                  <span
                    className={cn(
                      "text-[10px] font-mono hidden sm:block text-center leading-none",
                      isCompleted
                        ? "text-primary"
                        : isStepActive
                        ? "text-primary/80"
                        : "text-muted-foreground/50"
                    )}
                  >
                    {step.label}
                  </span>
                </div>

                {!isLast && (
                  <div
                    className={cn(
                      "hidden sm:block h-px flex-1 mx-1.5 transition-colors duration-300",
                      isCompleted ? "bg-primary/60" : "bg-border"
                    )}
                  />
                )}
                {!isLast && (
                  <span
                    className={cn(
                      "sm:hidden mx-1 text-[10px] font-mono",
                      isCompleted ? "text-primary/60" : "text-border"
                    )}
                  >
                    ›
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Overall thin progress bar */}
      <div className="relative w-full h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="absolute left-0 top-0 bottom-0 bg-primary transition-all duration-500 ease-out rounded-full"
          style={{
            width: `${Math.max(0, (isDone ? 1 : currentIndex / (PIPELINE_STEPS.length - 1)) * 100)}%`,
          }}
        />
        {progress > 0 && progress < 100 && (
          <div
            className="absolute left-0 top-0 bottom-0 bg-primary/40 transition-all duration-300 ease-out rounded-full"
            style={{
              width: `${
                (currentIndex / (PIPELINE_STEPS.length - 1)) * 100 +
                (progress / 100) * (100 / (PIPELINE_STEPS.length - 1))
              }%`,
            }}
          />
        )}
      </div>

      {/* Mobile active step label */}
      {currentIndex >= 0 && !isDone && (
        <p className="sm:hidden text-xs font-mono text-primary">
          ▶ {PIPELINE_STEPS[currentIndex]?.label}
        </p>
      )}
      {isDone && <p className="sm:hidden text-xs font-mono text-primary">✓ Complete</p>}

      {/* Per-stage detailed progress panel */}
      {isActive && <StageProgressPanel status={currentStatus} progress={progress} />}
    </div>
  );
}
