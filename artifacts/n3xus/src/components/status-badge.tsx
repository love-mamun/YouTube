import { cn } from "@/lib/utils";

type VideoJobStatus =
  | "pending"
  | "downloading"
  | "processing"
  | "generating"
  | "ready"
  | "approved"
  | "publishing"
  | "published"
  | "failed";

interface StatusBadgeProps {
  status: VideoJobStatus | string;
  className?: string;
}

const STATUS_VARIANTS: Record<string, { color: string; dot: string; label: string }> = {
  pending: {
    color: "bg-slate-800/70 text-slate-300 border-slate-700/80",
    dot: "bg-slate-400",
    label: "Queued",
  },
  downloading: {
    color: "bg-teal-500/10 text-teal-300 border-teal-500/25",
    dot: "bg-teal-400",
    label: "Downloading",
  },
  processing: {
    color: "bg-amber-500/10 text-amber-300 border-amber-500/25",
    dot: "bg-amber-400",
    label: "Encoding",
  },
  generating: {
    color: "bg-sky-500/10 text-sky-300 border-sky-500/25",
    dot: "bg-sky-400",
    label: "Preparing",
  },
  ready: {
    color: "bg-teal-500/12 text-teal-300 border-teal-500/30",
    dot: "bg-teal-400",
    label: "Ready",
  },
  approved: {
    color: "bg-emerald-500/10 text-emerald-300 border-emerald-500/25",
    dot: "bg-emerald-400",
    label: "Approved",
  },
  publishing: {
    color: "bg-amber-500/10 text-amber-300 border-amber-500/25",
    dot: "bg-amber-400",
    label: "Publishing",
  },
  published: {
    color: "bg-emerald-500/12 text-emerald-300 border-emerald-500/30",
    dot: "bg-emerald-400",
    label: "Published",
  },
  failed: {
    color: "bg-red-500/12 text-red-300 border-red-500/30",
    dot: "bg-red-400",
    label: "Failed",
  },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = STATUS_VARIANTS[status] || {
    color: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground",
    label: status,
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap shrink-0",
        config.color,
        className
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", config.dot)} aria-hidden="true" />
      {config.label}
    </span>
  );
}
