import { cn } from "@/lib/utils";
import { Check, Download, Clapperboard, Upload, AlertCircle } from "lucide-react";

const PIPELINE_STEPS = [
  { id: "pending", label: "Queue", short: "1" },
  { id: "downloading", label: "Download", short: "2" },
  { id: "processing", label: "Process", short: "3" },
  { id: "ready", label: "Review", short: "4" },
  { id: "approved", label: "Approved", short: "5" },
  { id: "publishing", label: "Publish", short: "6" },
  { id: "published", label: "Published", short: "7" },
];

function computeSubProgress(status: string, progress: number): number {
  switch (status) {
    case "downloading":
      return Math.round(Math.min(100, Math.max(0, ((progress - 20) / 22) * 100)));
    case "processing":
      return Math.round(Math.min(100, Math.max(0, ((progress - 45) / 27) * 100)));
    case "generating":
      return Math.round(Math.min(100, Math.max(0, ((progress - 75) / 13) * 100)));
    case "publishing":
      return Math.round(Math.min(100, Math.max(0, ((progress - 80) / 20) * 100)));
    default:
      return progress;
  }
}

const STAGE_META: Record<
  string,
  { icon: typeof Download; label: string; sublabel: string; barClass: string; textClass: string }
> = {
  downloading: {
    icon: Download,
    label: "Downloading video stream",
    sublabel: "Fetching source media from YouTube via yt-dlp",
    barClass: "bg-primary",
    textClass: "text-primary",
  },
  processing: {
    icon: Clapperboard,
    label: "Encoding with FFmpeg",
    sublabel: "Scaling, audio normalization, metadata strip & watermark",
    barClass: "bg-amber-400",
    textClass: "text-amber-300",
  },
  publishing: {
    icon: Upload,
    label: "Uploading to destination",
    sublabel: "Sending video & metadata to selected platform",
    barClass: "bg-emerald-400",
    textClass: "text-emerald-300",
  },
};

function StageProgressPanel({ status, progress }: { status: string; progress: number }) {
  const base = STAGE_META[status];
  if (!base) return null;

  const isPreparingPublish = status === "publishing" && progress < 89;
  const cfg = isPreparingPublish
    ? {
        icon: Download,
        label: "Preparing source video for upload",
        sublabel: "Downloading selected stream before platform upload",
        barClass: "bg-primary",
        textClass: "text-primary",
      }
    : base;

  const Icon = cfg.icon;
  const subPct = computeSubProgress(status, progress);
  const isIndeterminate = status === "generating" && subPct < 5;

  return (
    <div className="pt-4 border-t border-border/70 space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={cn("w-4 h-4 shrink-0", cfg.textClass)} />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{cfg.label}</p>
            <p className="text-xs text-muted-foreground truncate">{cfg.sublabel}</p>
          </div>
        </div>
        <span className={cn("font-mono text-base font-semibold tabular-nums shrink-0", cfg.textClass)}>
          {isIndeterminate ? "—" : `${subPct}%`}
        </span>
      </div>

      <div className="relative w-full h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-300 ease-out", cfg.barClass)}
          style={{ width: isIndeterminate ? "35%" : `${subPct}%` }}
        />
      </div>
    </div>
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
      <div className="flex items-center gap-2.5 py-2 text-sm text-red-300">
        <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
        <span className="font-medium">Pipeline stopped on error — review recovery actions below.</span>
      </div>
    );
  }

  const currentIndex = PIPELINE_STEPS.findIndex((s) => s.id === currentStatus);
  const isDone = currentStatus === "published";
  const isActive = ["downloading", "processing", "publishing"].includes(currentStatus);

  return (
    <div className="w-full space-y-4">
      <div className="overflow-x-auto pb-1 -mx-1 px-1">
        <div className="flex items-center min-w-max sm:min-w-0 sm:w-full gap-1 sm:gap-0">
          {PIPELINE_STEPS.map((step, index) => {
            const isCompleted = index < currentIndex || isDone;
            const isStepActive = index === currentIndex && !isDone;
            const isLast = index === PIPELINE_STEPS.length - 1;

            return (
              <div key={step.id} className="flex items-center sm:flex-1 sm:last:flex-none">
                <div className="flex flex-col items-center gap-1.5 min-w-[48px] sm:min-w-0">
                  <div
                    className={cn(
                      "w-7 h-7 rounded-full flex items-center justify-center text-xs font-mono font-semibold transition-colors duration-200 shrink-0",
                      isCompleted
                        ? "bg-primary text-primary-foreground"
                        : isStepActive
                        ? "bg-primary/15 text-primary border border-primary"
                        : "bg-muted text-muted-foreground border border-border"
                    )}
                  >
                    {isCompleted ? <Check className="w-3.5 h-3.5" /> : step.short}
                  </div>
                  <span
                    className={cn(
                      "text-[11px] font-medium text-center whitespace-nowrap",
                      isCompleted
                        ? "text-foreground"
                        : isStepActive
                        ? "text-primary"
                        : "text-muted-foreground/70"
                    )}
                  >
                    {step.label}
                  </span>
                </div>

                {!isLast && (
                  <div
                    className={cn(
                      "h-px w-4 sm:w-auto sm:flex-1 mx-1 sm:mx-2 -mt-5 transition-colors duration-200",
                      isCompleted ? "bg-primary/60" : "bg-border"
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Overall timeline bar */}
      <div className="relative w-full h-1 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-300 ease-out rounded-full"
          style={{
            width: `${Math.max(
              4,
              isDone
                ? 100
                : Math.min(
                    100,
                    ((Math.max(0, currentIndex) + (progress > 0 ? progress / 100 : 0.1)) /
                      (PIPELINE_STEPS.length - 1)) *
                      100
                  )
            )}%`,
          }}
        />
      </div>

      {isActive && <StageProgressPanel status={currentStatus} progress={progress} />}
    </div>
  );
}
