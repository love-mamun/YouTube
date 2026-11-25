import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type VideoJobStatus = "pending" | "downloading" | "processing" | "generating" | "ready" | "approved" | "publishing" | "published" | "failed";

interface StatusBadgeProps {
  status: VideoJobStatus | string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const variants: Record<string, { color: string; label: string }> = {
    pending: { color: "bg-muted text-muted-foreground border-muted-foreground/20", label: "Pending" },
    downloading: { color: "bg-blue-500/20 text-blue-400 border-blue-500/30 animate-pulse", label: "Downloading" },
    processing: { color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30 animate-pulse", label: "Processing" },
    generating: { color: "bg-purple-500/20 text-purple-400 border-purple-500/30 animate-pulse", label: "Generating" },
    ready: { color: "bg-primary/20 text-primary border-primary/30", label: "Ready" },
    approved: { color: "bg-green-500/20 text-green-400 border-green-500/30", label: "Approved" },
    publishing: { color: "bg-orange-500/20 text-orange-400 border-orange-500/30 animate-pulse", label: "Publishing" },
    published: { color: "bg-green-500/20 text-green-400 border-green-500/30", label: "Published" },
    failed: { color: "bg-destructive/20 text-destructive border-destructive/30", label: "Failed" },
  };

  const config = variants[status] || {
    color: "bg-muted text-muted-foreground border-muted-foreground/20",
    label: status,
  };

  return (
    <Badge
      variant="outline"
      className={cn(
        "font-mono uppercase tracking-wider text-[10px] px-2 py-0.5 border",
        config.color,
        className
      )}
    >
      {config.label}
    </Badge>
  );
}
