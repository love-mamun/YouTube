import { motion } from "framer-motion";
import { useListPublishLogs, getListPublishLogsQueryKey } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Youtube, Facebook, CheckCircle2, XCircle, Clock,
  Loader2, ExternalLink, Download,
} from "lucide-react";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";

type PlatformFilter = "all" | "youtube" | "facebook";
type StatusFilter   = "all" | "success" | "failed";

export default function Logs() {
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>("all");
  const [statusFilter, setStatusFilter]     = useState<StatusFilter>("all");

  const { data: logsRaw, isLoading } = useListPublishLogs(
    { limit: 200 },
    { query: { queryKey: getListPublishLogsQueryKey({ limit: 200 }), refetchInterval: 10000 } }
  );
  const logs = Array.isArray(logsRaw) ? logsRaw : [];

  const filtered = logs.filter((log) => {
    if (platformFilter !== "all") {
      const isYT = log.platform === "youtube" || log.platform === "youtube-shorts";
      if (platformFilter === "youtube" && !isYT) return false;
      if (platformFilter === "facebook" && isYT) return false;
    }
    if (statusFilter !== "all" && log.status !== statusFilter) return false;
    return true;
  });

  const statusIcon = (s: string) => {
    if (s === "success") return <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />;
    if (s === "failed")  return <XCircle className="w-4 h-4 text-destructive shrink-0" />;
    return <Clock className="w-4 h-4 text-amber-400 shrink-0" />;
  };

  const statusColor = (s: string) =>
    s === "success" ? "text-green-400" : s === "failed" ? "text-destructive" : "text-yellow-400";

  const platformIcon = (p: string) =>
    p === "youtube" || p === "youtube-shorts" ? (
      <Youtube className="w-3.5 h-3.5 text-red-500 shrink-0" />
    ) : (
      <Facebook className="w-3.5 h-3.5 text-blue-500 shrink-0" />
    );

  const exportCSV = () => {
    const header = "ID,Mission,Platform,Status,Time,URL\n";
    const rows = filtered
      .map(
        (l) =>
          `${l.id},${l.jobId},${l.platform},${l.status},"${l.createdAt ?? ""}","${l.platformUrl ?? ""}"`
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `publish-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(href);
  };

  const emptyState = (
    <div className="flex flex-col items-center justify-center h-48 text-muted-foreground font-mono px-4 text-center">
      <p className="text-sm">No publish events match the selected filters.</p>
      <p className="text-xs mt-1 opacity-60">Try adjusting the filters above.</p>
    </div>
  );

  const FilterBtn = ({
    active, onClick, children,
  }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-mono rounded-md border transition-colors ${
        active
          ? "bg-primary/10 border-primary/40 text-primary"
          : "border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );

  return (
    <Layout>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="space-y-5 sm:space-y-6"
      >
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-display font-semibold tracking-tight text-foreground">Activity Logs</h1>
            <p className="text-muted-foreground text-sm mt-1">Complete history of all publish attempts and outcomes.</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={exportCSV}
            disabled={filtered.length === 0}
            className="gap-1.5 font-medium text-xs min-h-[40px] border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground self-start sm:self-auto shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Platform:</span>
            <FilterBtn active={platformFilter === "all"}     onClick={() => setPlatformFilter("all")}>All</FilterBtn>
            <FilterBtn active={platformFilter === "youtube"} onClick={() => setPlatformFilter("youtube")}>
              <span className="flex items-center gap-1"><Youtube className="w-3 h-3 text-red-400" />YouTube</span>
            </FilterBtn>
            <FilterBtn active={platformFilter === "facebook"} onClick={() => setPlatformFilter("facebook")}>
              <span className="flex items-center gap-1"><Facebook className="w-3 h-3 text-blue-400" />Facebook</span>
            </FilterBtn>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Status:</span>
            <FilterBtn active={statusFilter === "all"}     onClick={() => setStatusFilter("all")}>All</FilterBtn>
            <FilterBtn active={statusFilter === "success"} onClick={() => setStatusFilter("success")}>
              <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-green-400" />Success</span>
            </FilterBtn>
            <FilterBtn active={statusFilter === "failed"}  onClick={() => setStatusFilter("failed")}>
              <span className="flex items-center gap-1"><XCircle className="w-3 h-3 text-destructive" />Failed</span>
            </FilterBtn>
          </div>
        </div>

        {/* Count */}
        {!isLoading && logs.length > 0 && (
          <p className="text-[11px] font-mono text-muted-foreground">
            Showing {filtered.length} of {logs.length} entries
          </p>
        )}

        {/* ── Desktop Table ──────────────────────────────────── */}
        <Card className="border-border bg-card/80 backdrop-blur-sm overflow-hidden hidden sm:block">
          <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-0 border-b border-border px-4 py-2.5">
            <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground w-24">Status</span>
            <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground px-4">Mission</span>
            <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground px-4">Platform</span>
            <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground px-4 text-right">Time</span>
            <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground text-right">Link</span>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : filtered.length === 0 ? (
            emptyState
          ) : (
            <div className="divide-y divide-border">
              {filtered.map((log, i) => (
                <motion.div
                  key={log.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.02 }}
                  className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-0 px-4 py-3 items-center hover:bg-muted/20 transition-colors"
                >
                  <div className="w-24 flex items-center gap-2">
                    {statusIcon(log.status)}
                    <span className={`text-xs font-mono uppercase ${statusColor(log.status)}`}>{log.status}</span>
                  </div>
                  <div className="px-4 min-w-0">
                    <Link href={`/jobs/${log.jobId}`}>
                      <span className="text-sm text-foreground hover:text-primary font-medium font-mono cursor-pointer">
                        Mission #{log.jobId}
                      </span>
                    </Link>
                    {log.errorMessage && (
                      <p className="text-xs text-destructive font-mono truncate mt-0.5">{log.errorMessage}</p>
                    )}
                  </div>
                  <div className="px-4">
                    <div className="flex items-center gap-1.5">
                      {platformIcon(log.platform)}
                      <span className="text-xs text-muted-foreground font-mono capitalize">{log.platform}</span>
                    </div>
                  </div>
                  <div className="px-4 text-right">
                    <span className="text-xs text-muted-foreground font-mono">
                      {log.createdAt ? formatDistanceToNow(new Date(log.createdAt), { addSuffix: true }) : "—"}
                    </span>
                  </div>
                  <div className="text-right">
                    {log.platformUrl ? (
                      <a href={log.platformUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    ) : (
                      <ExternalLink className="w-3.5 h-3.5 text-muted-foreground/25" />
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </Card>

        {/* ── Mobile Cards ───────────────────────────────────── */}
        <div className="sm:hidden space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : filtered.length === 0 ? (
            <Card className="p-8 border-border bg-card/80 backdrop-blur-sm text-center text-muted-foreground text-sm font-mono">
              No events match your filters.
            </Card>
          ) : (
            filtered.map((log, i) => (
              <motion.div
                key={log.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.02 }}
              >
                <Card className="p-3.5 border-border bg-card/80 backdrop-blur-sm">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-1.5">
                      {statusIcon(log.status)}
                      <span className={`text-xs font-mono font-semibold uppercase ${statusColor(log.status)}`}>
                        {log.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {platformIcon(log.platform)}
                      <span className="text-xs text-muted-foreground font-mono capitalize">{log.platform}</span>
                    </div>
                  </div>

                  <Link href={`/jobs/${log.jobId}`}>
                    <p className="text-sm font-medium text-foreground hover:text-primary font-mono cursor-pointer mb-1">
                      Mission #{log.jobId}
                    </p>
                  </Link>

                  {log.errorMessage && (
                    <p className="text-xs text-destructive font-mono mb-2 leading-relaxed break-words">
                      {log.errorMessage}
                    </p>
                  )}

                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/40">
                    <span className="text-xs text-muted-foreground font-mono">
                      {log.createdAt ? formatDistanceToNow(new Date(log.createdAt), { addSuffix: true }) : "—"}
                    </span>
                    {log.platformUrl ? (
                      <a
                        href={log.platformUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-primary hover:underline font-mono"
                      >
                        <ExternalLink className="w-3 h-3" /> View
                      </a>
                    ) : null}
                  </div>
                </Card>
              </motion.div>
            ))
          )}
        </div>
      </motion.div>
    </Layout>
  );
}
