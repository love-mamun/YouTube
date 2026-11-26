import { Link } from "wouter";
import { motion } from "framer-motion";
import {
  useListJobs,
  useDeleteJob,
  getListJobsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
import {
  Trash2,
  Search,
  Plus,
  Loader2,
  ArrowRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Square,
  CheckSquare,
  X,
  ListVideo,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

function detectPlatformLabel(url?: string | null): string {
  if (!url) return "Direct";
  if (/youtube\.com\/shorts/i.test(url)) return "YouTube Shorts";
  if (/youtube\.com|youtu\.be/i.test(url)) return "YouTube";
  if (/facebook\.com|fb\.watch|fb\.com/i.test(url)) return "Facebook";
  return "Video";
}

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
        queryKey: getListJobsQueryKey({
          status: statusFilter === "all" ? undefined : statusFilter,
        }),
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
        deleteJob.mutate(
          { id },
          { onSuccess: () => resolve(), onError: () => resolve() }
        );
      });
    }
    setSelected(new Set());
    setBulkDeleting(false);
    queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
  };

  const SortIcon = ({ col }: { col: "created" | "status" }) => {
    if (sortCol !== col) return <ArrowUpDown className="w-3.5 h-3.5 opacity-45" />;
    return sortDir === "asc" ? (
      <ArrowUp className="w-3.5 h-3.5 text-primary" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-primary" />
    );
  };

  const statuses = [
    "all",
    "pending",
    "downloading",
    "processing",
    "generating",
    "ready",
    "approved",
    "publishing",
    "published",
    "failed",
  ];

  return (
    <Layout>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="space-y-5"
      >
        {/* Header */}
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-display font-semibold tracking-tight text-foreground">
              All Jobs
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage active downloads, review drafts, and retry failed missions.
            </p>
          </div>
          <Link href="/new">
            <Button className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 font-medium text-sm min-h-[44px] px-4 shrink-0">
              <Plus className="w-4 h-4" />
              <span>New Mission</span>
            </Button>
          </Link>
        </div>

        {/* Search & Filter Bar */}
        <div className="flex flex-col sm:flex-row gap-2.5 sm:gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search missions, URLs, or tags..."
              className="pl-10 text-sm bg-card border-border focus:border-primary min-h-[44px] h-11"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-48 text-sm bg-card border-border min-h-[44px] h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statuses.map((s) => (
                <SelectItem key={s} value={s} className="capitalize text-sm">
                  {s === "all" ? "All Statuses" : s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Bulk Action Bar */}
        {selected.size > 0 && (
          <div className="flex items-center justify-between gap-3 px-4 py-2 bg-primary/10 border border-primary/25 rounded-lg">
            <div className="flex items-center gap-2 text-sm font-medium text-primary tabular-nums">
              <CheckSquare className="w-4 h-4" />
              <span>{selected.size} selected</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelected(new Set())}
                className="text-xs min-h-[36px] text-muted-foreground hover:text-foreground gap-1"
              >
                <X className="w-3.5 h-3.5" /> Clear
              </Button>
              <Button
                size="sm"
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                className="text-xs min-h-[36px] bg-destructive text-white hover:bg-destructive/90 gap-1.5"
              >
                {bulkDeleting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                Delete {selected.size}
              </Button>
            </div>
          </div>
        )}

        {/* Desktop Table */}
        <Card className="border-border bg-card overflow-hidden hidden md:block">
          <div className="grid grid-cols-[44px_1fr_160px_140px_96px] border-b border-border px-3 py-2.5 items-center text-xs font-medium text-muted-foreground">
            <div className="flex items-center justify-center">
              <button
                type="button"
                onClick={toggleSelectAll}
                className="w-9 h-9 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                title="Select all"
              >
                {selected.size === sorted.length && sorted.length > 0 ? (
                  <CheckSquare className="w-4 h-4 text-primary" />
                ) : (
                  <Square className="w-4 h-4" />
                )}
              </button>
            </div>
            <span className="px-2">Mission</span>
            <button
              type="button"
              onClick={() => toggleSort("status")}
              className="flex items-center gap-1.5 px-2 hover:text-foreground transition-colors text-left"
            >
              Status <SortIcon col="status" />
            </button>
            <button
              type="button"
              onClick={() => toggleSort("created")}
              className="flex items-center justify-end gap-1.5 px-2 hover:text-foreground transition-colors"
            >
              Created <SortIcon col="created" />
            </button>
            <span className="text-right pr-2">Actions</span>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center px-4">
              <ListVideo className="w-7 h-7 text-muted-foreground/70 mb-2" />
              <p className="text-sm text-muted-foreground">
                {search || statusFilter !== "all"
                  ? "No missions match your filter."
                  : "No missions yet. Launch one to begin."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {sorted.map((job) => (
                <div
                  key={job.id}
                  className="grid grid-cols-[44px_1fr_160px_140px_96px] px-3 py-2.5 hover:bg-muted/30 transition-colors items-center min-h-[56px]"
                >
                  <div className="flex items-center justify-center">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleSelect(job.id);
                      }}
                      className="w-9 h-9 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                      aria-label={`Select mission ${job.id}`}
                    >
                      {selected.has(job.id) ? (
                        <CheckSquare className="w-4 h-4 text-primary" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>
                  </div>

                  <Link href={`/jobs/${job.id}`}>
                    <div className="min-w-0 px-2 cursor-pointer">
                      <p className="text-sm font-medium text-foreground truncate">
                        {job.title || job.originalTitle || `Mission #${job.id}`}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">
                        {detectPlatformLabel(job.youtubeUrl)}
                        {job.youtubeUrl ? ` · ${job.youtubeUrl}` : ""}
                      </p>
                    </div>
                  </Link>

                  <div className="px-2">
                    <StatusBadge status={job.status} />
                  </div>

                  <div className="px-2 text-right">
                    <span className="text-xs text-muted-foreground font-mono tabular-nums">
                      {job.createdAt
                        ? formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })
                        : "—"}
                    </span>
                  </div>

                  <div className="flex items-center justify-end gap-1">
                    <Link href={`/jobs/${job.id}`}>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="w-9 h-9 text-muted-foreground hover:text-primary"
                        aria-label={`Open mission ${job.id}`}
                      >
                        <ArrowRight className="w-4 h-4" />
                      </Button>
                    </Link>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="w-9 h-9 text-muted-foreground hover:text-destructive"
                      onClick={(e) => handleDelete(e, job.id)}
                      disabled={deletingId === job.id}
                      aria-label={`Delete mission ${job.id}`}
                    >
                      {deletingId === job.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Mobile List */}
        <Card className="md:hidden border-border bg-card overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center h-36">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : sorted.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              {search || statusFilter !== "all"
                ? "No missions match your filter."
                : "No missions yet."}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {sorted.map((job) => (
                <Link key={job.id} href={`/jobs/${job.id}`}>
                  <div className="p-4 min-h-[72px] hover:bg-muted/30 active:bg-muted/50 transition-colors cursor-pointer flex items-center gap-2">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <p className="text-sm font-medium text-foreground line-clamp-2 leading-snug">
                        {job.title || job.originalTitle || `Mission #${job.id}`}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <StatusBadge status={job.status} />
                        <span className="text-xs text-muted-foreground font-mono tabular-nums">
                          {detectPlatformLabel(job.youtubeUrl)}
                          {job.createdAt
                            ? ` · ${formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })}`
                            : ""}
                        </span>
                      </div>
                    </div>

                    <Button
                      size="icon"
                      variant="ghost"
                      className="w-11 h-11 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg shrink-0"
                      onClick={(e) => handleDelete(e, job.id)}
                      disabled={deletingId === job.id}
                      aria-label={`Delete mission ${job.id}`}
                    >
                      {deletingId === job.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </motion.div>
    </Layout>
  );
}
