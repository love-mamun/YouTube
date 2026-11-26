import { Link } from "wouter";
import { motion } from "framer-motion";
import {
  useGetStats,
  useListJobs,
  useCreateJob,
  getGetStatsQueryKey,
  getListJobsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { StatusBadge } from "@/components/status-badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useState, useEffect, useRef } from "react";
import {
  Activity,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Play,
  TrendingUp,
  Loader2,
  ArrowRight,
  TrendingDown,
  Minus,
  ChevronRight,
  Video,
  SlidersHorizontal,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface UrlPreview {
  thumbnail: string;
  title: string;
}

function extractYouTubeId(url: string): string | null {
  const m = url.match(/(?:v=|youtu\.be\/|shorts\/)([^&?/]+)/);
  return m?.[1] ?? null;
}

function detectPlatformLabel(url?: string | null): string {
  if (!url) return "Direct";
  if (/youtube\.com\/shorts/i.test(url)) return "YouTube Shorts";
  if (/youtube\.com|youtu\.be/i.test(url)) return "YouTube";
  if (/facebook\.com|fb\.watch|fb\.com/i.test(url)) return "Facebook";
  return "Video";
}

function formatPublishMode(mode?: string | null): string {
  if (mode === "auto") return "Auto publish";
  if (mode === "scheduled") return "Scheduled";
  return "Manual review";
}

const ACTIVE_JOB_STATUSES = new Set([
  "downloading",
  "processing",
  "generating",
  "publishing",
]);

export default function Dashboard() {
  const [url, setUrl] = useState("");
  const [urlPreview, setUrlPreview] = useState<UrlPreview | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const initialStats = useRef<{
    totalJobs: number;
    publishedToday: number;
    pendingJobs: number;
    totalPublished: number;
  } | null>(null);

  const { data: stats, isLoading: statsLoading } = useGetStats({
    query: { queryKey: getGetStatsQueryKey(), refetchInterval: 5000 },
  });
  const { data: jobsRaw } = useListJobs(
    { limit: 8 },
    { query: { queryKey: getListJobsQueryKey({ limit: 8 }), refetchInterval: 3000 } }
  );
  const jobs = Array.isArray(jobsRaw) ? jobsRaw : [];

  useEffect(() => {
    if (stats && !initialStats.current) {
      initialStats.current = {
        totalJobs: stats.totalJobs ?? 0,
        publishedToday: stats.publishedToday ?? 0,
        pendingJobs: stats.pendingJobs ?? 0,
        totalPublished: stats.totalPublished ?? 0,
      };
    }
  }, [stats]);

  useEffect(() => {
    clearTimeout(previewTimer.current);
    setPreviewFailed(false);
    if (!url.trim() || !/youtube\.com|youtu\.be/i.test(url)) {
      setUrlPreview(null);
      return;
    }
    previewTimer.current = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const res = await fetch(
          `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
        );
        if (res.ok) {
          const data = (await res.json()) as {
            title?: string;
            thumbnail_url?: string;
          };
          const vid = extractYouTubeId(url);
          setUrlPreview({
            thumbnail: vid
              ? `https://img.youtube.com/vi/${vid}/hqdefault.jpg`
              : data.thumbnail_url ?? "",
            title: data.title ?? "",
          });
        } else {
          setUrlPreview(null);
        }
      } catch {
        setUrlPreview(null);
      }
      setPreviewLoading(false);
    }, 600);
    return () => clearTimeout(previewTimer.current);
  }, [url]);

  const queryClient = useQueryClient();
  const createJob = useCreateJob({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetStatsQueryKey() });
        setUrl("");
        setUrlPreview(null);
      },
    },
  });

  const submitError = createJob.isError
    ? (createJob.error as { message?: string })?.message ?? "Failed to create mission"
    : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    createJob.mutate({
      data: { youtubeUrl: url.trim(), publishMode: "manual", platforms: "youtube" },
    });
  };

  const trendFor = (key: keyof NonNullable<typeof initialStats.current>) => {
    if (!initialStats.current || !stats) return 0;
    const cur = (stats as unknown as Record<string, number>)[key as string] ?? 0;
    return cur - (initialStats.current[key] ?? 0);
  };

  const TrendIndicator = ({ delta }: { delta: number }) => {
    if (delta === 0) {
      return (
        <span className="inline-flex items-center gap-0.5 text-xs font-mono tabular-nums text-muted-foreground/70">
          <Minus className="w-3 h-3" />
        </span>
      );
    }
    if (delta > 0) {
      return (
        <span className="inline-flex items-center gap-0.5 text-xs font-mono tabular-nums text-emerald-400">
          <TrendingUp className="w-3 h-3" />+{delta}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-mono tabular-nums text-red-400">
        <TrendingDown className="w-3 h-3" />
        {delta}
      </span>
    );
  };

  const statItems = [
    {
      label: "Total Jobs",
      key: "totalJobs" as const,
      value: stats?.totalJobs ?? 0,
      icon: Activity,
      accentClass: "text-primary",
    },
    {
      label: "Published Today",
      key: "publishedToday" as const,
      value: stats?.publishedToday ?? 0,
      icon: CheckCircle2,
      accentClass: "text-emerald-400",
    },
    {
      label: "In Queue",
      key: "pendingJobs" as const,
      value: stats?.pendingJobs ?? 0,
      icon: Clock,
      accentClass: "text-amber-400",
    },
    {
      label: "Total Published",
      key: "totalPublished" as const,
      value: stats?.totalPublished ?? 0,
      icon: TrendingUp,
      accentClass: "text-foreground",
    },
  ];

  return (
    <Layout>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="space-y-6"
      >
        {/* Header Row */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-display font-semibold tracking-tight text-foreground">
              Mission Control
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Queue a video link, monitor live processing stages, and review before publishing.
            </p>
          </div>
          <Link href="/new">
            <Button
              variant="outline"
              className="gap-2 min-h-[44px] text-sm font-medium border-border bg-card hover:bg-muted w-full sm:w-auto"
            >
              <SlidersHorizontal className="w-4 h-4 text-primary" />
              Studio Setup
            </Button>
          </Link>
        </div>

        {/* Quick Launch Card */}
        <Card className="p-4 sm:p-6 border-border bg-card space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-display font-semibold text-foreground">
                Quick Launch
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Starts a standard manual-review mission for YouTube.
              </p>
            </div>
            <Link
              href="/4k-mission"
              className="text-xs font-medium text-primary hover:underline whitespace-nowrap shrink-0 min-h-[44px] inline-flex items-center"
            >
              4K Studio →
            </Link>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste YouTube or Facebook video URL..."
              className="flex-1 font-mono text-sm bg-muted/60 border-border focus:border-primary min-h-[44px] h-11"
            />
            <Button
              type="submit"
              disabled={createJob.isPending || !url.trim()}
              className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-medium min-h-[44px] h-11 px-5 shrink-0"
            >
              {createJob.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              Launch Mission
            </Button>
          </form>

          {previewLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" /> Fetching video details…
            </div>
          )}

          {urlPreview && !previewLoading && (
            <div className="flex items-center gap-3 pt-3 border-t border-border/70">
              {urlPreview.thumbnail && !previewFailed ? (
                <img
                  src={urlPreview.thumbnail}
                  alt={urlPreview.title || "Video preview"}
                  className="w-24 aspect-video object-cover rounded-md shrink-0 bg-muted"
                  onError={() => setPreviewFailed(true)}
                />
              ) : (
                <div className="w-24 aspect-video rounded-md shrink-0 bg-muted flex items-center justify-center text-muted-foreground">
                  <Video className="w-5 h-5" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground line-clamp-2 leading-snug">
                  {urlPreview.title || "Video ready to launch"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                  {detectPlatformLabel(url)} · Manual review
                </p>
              </div>
            </div>
          )}

          {submitError && (
            <div className="flex items-center gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/25 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}
        </Card>

        {/* Unified 4-Column KPI Strip */}
        <Card className="border-border bg-card overflow-hidden">
          <div className="grid grid-cols-2 lg:grid-cols-4 [&>*:nth-child(odd)]:border-r [&>*:nth-child(-n+2)]:border-b lg:[&>*]:border-b-0 lg:[&>*:not(:last-child)]:border-r [&>*]:border-border">
            {statItems.map((item) => {
              const Icon = item.icon;
              const delta = trendFor(item.key);
              return (
                <div key={item.label} className="p-4 sm:p-5 flex flex-col justify-between gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground truncate">
                      {item.label}
                    </span>
                    <Icon className={`w-4 h-4 shrink-0 ${item.accentClass}`} />
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-2xl sm:text-3xl font-display font-semibold tabular-nums text-foreground">
                      {statsLoading ? "—" : item.value.toLocaleString()}
                    </span>
                    {!statsLoading && <TrendIndicator delta={delta} />}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Recent Missions List */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-display font-semibold text-foreground">
              Recent Missions
            </h2>
            <Link
              href="/jobs"
              className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1 min-h-[44px]"
            >
              View all jobs <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {!jobs || jobs.length === 0 ? (
            <Card className="p-8 sm:p-12 border-border bg-card text-center space-y-2">
              <Activity className="w-8 h-8 text-muted-foreground mx-auto" />
              <p className="text-sm font-medium text-foreground">No missions launched yet</p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Paste a YouTube or Facebook link in Quick Launch above to queue your first video.
              </p>
            </Card>
          ) : (
            <Card className="border-border bg-card overflow-hidden">
              <div className="divide-y divide-border">
                {jobs.map((job) => {
                  const isRunning = ACTIVE_JOB_STATUSES.has(job.status);
                  const pct = typeof job.progress === "number" ? job.progress : null;
                  const relTime = job.createdAt
                    ? formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })
                    : "";
                  const platformLabel = detectPlatformLabel(job.youtubeUrl);

                  return (
                    <Link key={job.id} href={`/jobs/${job.id}`}>
                      <div className="px-4 py-3.5 min-h-[64px] hover:bg-muted/35 transition-colors cursor-pointer flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="text-sm font-medium text-foreground truncate">
                            {job.title || job.originalTitle || job.youtubeUrl || `Mission #${job.id}`}
                          </p>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground font-mono">
                            <span>{platformLabel}</span>
                            <span aria-hidden="true">·</span>
                            <span>{formatPublishMode(job.publishMode)}</span>
                            {relTime && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="tabular-nums">{relTime}</span>
                              </>
                            )}
                          </div>
                          {isRunning && pct !== null && (
                            <div className="flex items-center gap-2 pt-1 max-w-xs">
                              <div className="h-1 flex-1 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-primary rounded-full transition-all duration-300"
                                  style={{ width: `${Math.max(4, Math.min(100, pct))}%` }}
                                />
                              </div>
                              <span className="text-[11px] font-mono tabular-nums text-primary">
                                {pct}%
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2.5 shrink-0">
                          <StatusBadge status={job.status} />
                          <ChevronRight className="w-4 h-4 text-muted-foreground hidden sm:block" />
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </Card>
          )}
        </section>
      </motion.div>
    </Layout>
  );
}
