import { Link } from "wouter";
import { motion } from "framer-motion";
import { useListJobs, useDeleteJob, getListJobsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import {
  Trash2, Search, Plus, Loader2, ArrowRight,
  ArrowUpDown, ArrowUp, ArrowDown,
  Square, CheckSquare, X,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function Jobs() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [sortCol, setSortCol] = useState<"created" | "status">("created");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const { data: jobsRaw, isLoading } = useListJobs(
    { status: statusFilter === "all" ? undefined : statusFilter },
    {
      query: {
        queryKey: getListJobsQueryKey({ status: statusFilter === "all" ? undefined : statusFilter }),
        refetchInterval: 4000,
      },
    }
  );
  const jobs = Array.isArray(jobsRaw) ? jobsRaw : [];

  const queryClient = useQueryClient();
  const deleteJob = useDeleteJob({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
        setDeletingId(null);
      },
    },
  });

  const handleDelete = (e: React.MouseEvent, id: number) => {
    e.preventDefault();
    e.stopPropagation();
    setDeletingId(id);
    deleteJob.mutate({ id });
  };

  const filtered = jobs.filter((j) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (j.title || "").toLowerCase().includes(q) ||
      (j.youtubeUrl || "").toLowerCase().includes(q) ||
      (j.originalTitle || "").toLowerCase().includes(q) ||
      (j.tags || "").toLowerCase().includes(q)
    );
  });

  const toggleSort = (col: "created" | "status") => {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  const sorted = [...filtered].sort((a, b) => {
    if (sortCol === "status") {
      const cmp = (a.status || "").localeCompare(b.status || "");
      return sortDir === "asc" ? cmp : -cmp;
    }
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return sortDir === "asc" ? aTime - bTime : bTime - aTime;
  });

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === sorted.length && sorted.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sorted.map((j) => j.id)));
    }
  };

  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    for (const id of Array.from(selected)) {
      await new Promise<void>((resolve) => {
        deleteJob.mutate({ id }, { onSuccess: () => resolve(), onError: () => resolve() });
      });
    }
    setSelected(new Set());
    setBulkDeleting(false);
    queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
  };

  const SortIcon = ({ col }: { col: "created" | "status" }) => {
    if (sortCol !== col) return <ArrowUpDown className="w-3 h-3 opacity-40" />;
    return sortDir === "asc" ? (
      <ArrowUp className="w-3 h-3 text-primary" />
    ) : (
      <ArrowDown className="w-3 h-3 text-primary" />
    );
  };

  const statuses = [
    "all", "pending", "downloading", "processing", "generating",
    "ready", "approved", "publishing", "published", "failed",
  ];

  return (
    <Layout>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="space-y-5 sm:space-y-6"
      >
        {/* Header */}
        <div className="flex items-end justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground mb-1 tracking-widest uppercase">
              <div className="w-1.5 h-1.5 rounded-full bg-primary" />
              Mission Queue
            </div>
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground">All Jobs</h1>
          </div>
          <Link href="/new">
            <Button className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/80 font-mono text-xs">
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">New Mission</span>
              <span className="sm:hidden">New</span>
            </Button>
          </Link>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search missions or tags..."
              className="pl-9 font-mono text-sm bg-muted border-border"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-44 font-mono text-sm bg-muted border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statuses.map((s) => (
                <SelectItem key={s} value={s} className="font-mono capitalize text-sm">
                  {s === "all" ? "All Statuses" : s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-between gap-3 px-4 py-2.5 bg-primary/10 border border-primary/30 rounded-lg"
          >
            <div className="flex items-center gap-2">
              <CheckSquare className="w-4 h-4 text-primary" />
              <span className="text-sm font-mono text-primary">{selected.size} selected</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelected(new Set())}
                className="text-xs font-mono h-7 text-muted-foreground gap-1"
              >
                <X className="w-3 h-3" /> Clear
              </Button>
              <Button
                size="sm"
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                className="text-xs font-mono h-7 bg-destructive text-white hover:bg-destructive/80 gap-1"
              >
                {bulkDeleting ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Trash2 className="w-3 h-3" />
                )}
                Delete {selected.size}
              </Button>
            </div>
          </motion.div>
        )}

        {/* ── Desktop Table ─────────────────────────────────────────── */}
        <Card className="border-border bg-card/80 backdrop-blur-sm overflow-hidden hidden sm:block">
          <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-0 border-b border-border px-4 py-2.5 items-center">
            <div className="w-8 flex items-center justify-center">
              <button
                onClick={toggleSelectAll}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Select all"
              >
                {selected.size === sorted.length && sorted.length > 0 ? (
                  <CheckSquare className="w-3.5 h-3.5 text-primary" />
                ) : (
                  <Square className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
            <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Mission</span>
            <button
              onClick={() => toggleSort("status")}
              className="flex items-center gap-1 text-xs font-mono uppercase tracking-widest text-muted-foreground px-4 hover:text-foreground transition-colors"
            >
              Status <SortIcon col="status" />
            </button>
            <button
              onClick={() => toggleSort("created")}
              className="flex items-center gap-1 text-xs font-mono uppercase tracking-widest text-muted-foreground px-4 hover:text-foreground transition-colors"
            >
              Created <SortIcon col="created" />
            </button>
            <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground text-right">
              Actions
            </span>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : sorted.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground text-sm font-mono">
              {search || statusFilter !== "all"
                ? "No missions match your filter."
                : "No missions yet. Launch one above."}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {sorted.map((job, i) => (
                <motion.div
                  key={job.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.02 }}
                >
                  <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-0 px-4 py-3 hover:bg-muted/30 transition-colors items-center">
                    <div className="w-8 flex items-center justify-center">
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleSelect(job.id); }}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {selected.has(job.id) ? (
                          <CheckSquare className="w-3.5 h-3.5 text-primary" />
                        ) : (
                          <Square className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                    <Link href={`/jobs/${job.id}`}>
                      <div className="min-w-0 cursor-pointer">
                        <p className="text-sm font-medium text-foreground truncate">
                          {job.title || job.originalTitle || "Untitled Mission"}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">
                          {job.youtubeUrl || "—"}
                        </p>
                      </div>
                    </Link>
                    <div className="px-4">
                      <StatusBadge status={job.status} />
                    </div>
                    <div className="px-4 text-right">
                      <span className="text-xs text-muted-foreground font-mono">
                        {job.createdAt
                          ? formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })
                          : "—"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Link href={`/jobs/${job.id}`}>
                        <Button size="icon" variant="ghost" className="w-7 h-7 hover:text-primary">
                          <ArrowRight className="w-3.5 h-3.5" />
                        </Button>
                      </Link>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="w-7 h-7 hover:text-destructive"
                        onClick={(e) => handleDelete(e, job.id)}
                        disabled={deletingId === job.id}
                      >
                        {deletingId === job.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </Card>

        {/* ── Mobile Cards ──────────────────────────────────────────── */}
        <div className="sm:hidden space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : sorted.length === 0 ? (
            <Card className="p-8 border-border bg-card/80 backdrop-blur-sm text-center text-muted-foreground text-sm font-mono">
              {search || statusFilter !== "all" ? "No missions match your filter." : "No missions yet."}
            </Card>
          ) : (
            sorted.map((job, i) => (
              <motion.div
                key={job.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.02 }}
              >
                <Link href={`/jobs/${job.id}`}>
                  <Card className="p-4 border-border bg-card/80 backdrop-blur-sm hover:border-primary/40 transition-all cursor-pointer active:scale-[0.99]">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <p className="text-sm font-medium text-foreground line-clamp-2 flex-1 leading-snug">
                        {job.title || job.originalTitle || "Untitled Mission"}
                      </p>
                      <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                    </div>
                    <p className="text-xs text-muted-foreground font-mono truncate mb-3">
                      {job.youtubeUrl || "—"}
                    </p>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={job.status} />
                        <span className="text-xs text-muted-foreground font-mono">
                          {job.createdAt
                            ? formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })
                            : "—"}
                        </span>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="w-10 h-10 hover:text-destructive hover:bg-destructive/10 rounded-lg"
                        onClick={(e) => handleDelete(e, job.id)}
                        disabled={deletingId === job.id}
                      >
                        {deletingId === job.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                  </Card>
                </Link>
              </motion.div>
            ))
          )}
        </div>
      </motion.div>
    </Layout>
  );
}
