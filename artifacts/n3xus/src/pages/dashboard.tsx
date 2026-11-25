import { Link } from "wouter";
import { motion } from "framer-motion";
import { useGetStats, useListJobs, useCreateJob, getGetStatsQueryKey, getListJobsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { StatusBadge } from "@/components/status-badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useState, useEffect, useRef } from "react";
import {
  Activity, CheckCircle2, Clock, AlertTriangle, Play, TrendingUp,
  Loader2, ArrowRight, TrendingDown, Minus,
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

export default function Dashboard() {
  const [url, setUrl] = useState("");
  const [urlPreview, setUrlPreview] = useState<UrlPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewTimer = useRef<ReturnType<typeof setTimeout>>();
  const initialStats = useRef<{ totalJobs: number; publishedToday: number; pendingJobs: number; totalPublished: number } | null>(null);

  const { data: stats, isLoading: statsLoading } = useGetStats({
    query: { queryKey: getGetStatsQueryKey(), refetchInterval: 5000 },
  });
  const { data: jobsRaw } = useListJobs(
    { limit: 8 },
    { query: { queryKey: getListJobsQueryKey({ limit: 8 }), refetchInterval: 3000 } }
  );
  const jobs = Array.isArray(jobsRaw) ? jobsRaw : [];

  // Capture first load for trend comparison
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

  // YouTube oEmbed preview
  useEffect(() => {
    clearTimeout(previewTimer.current);
    if (!url.trim() || (!/youtube\.com|youtu\.be/i.test(url))) {
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
          const data = (await res.json()) as { title?: string; thumbnail_url?: string };
          const vid = extractYouTubeId(url);
          setUrlPreview({
            thumbnail: vid
              ? `https://img.youtube.com/vi/${vid}/hqdefault.jpg`
              : (data.thumbnail_url ?? ""),
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
    ? (createJob.error as { message?: string })?.message ?? "Failed to create job"
    : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    createJob.mutate({ data: { youtubeUrl: url, publishMode: "manual", platforms: "youtube" } });
  };

  // Trend helpers
  const trendFor = (key: keyof typeof initialStats.current) => {
    if (!initialStats.current || !stats) return 0;
    const cur = (stats as Record<string, number>)[key as string] ?? 0;
    return cur - (initialStats.current[key] ?? 0);
  };

  const TrendBadge = ({ delta }: { delta: number }) => {
    if (delta === 0) return <Minus className="w-3 h-3 text-muted-foreground/50" />;
    if (delta > 0)
      return (
        <span className="flex items-center gap-0.5 text-[10px] font-mono text-green-400">
          <TrendingUp className="w-3 h-3" />+{delta}
        </span>
      );
    return (
      <span className="flex items-center gap-0.5 text-[10px] font-mono text-red-400">
        <TrendingDown className="w-3 h-3" />{delta}
      </span>
    );
  };

  const statCards = [
    { label: "Total Jobs",      key: "totalJobs",      value: stats?.totalJobs ?? 0,      icon: Activity,    color: "text-primary",   bg: "bg-primary/10"   },
    { label: "Published Today", key: "publishedToday", value: stats?.publishedToday ?? 0, icon: CheckCircle2, color: "text-green-400", bg: "bg-green-500/10" },
    { label: "In Queue",        key: "pendingJobs",    value: stats?.pendingJobs ?? 0,    icon: Clock,        color: "text-yellow-400",bg: "bg-yellow-500/10"},
    { label: "Total Published", key: "totalPublished", value: stats?.totalPublished ?? 0, icon: TrendingUp,   color: "text-secondary", bg: "bg-secondary/10" },
  ] as const;

  return (
    <Layout>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="space-y-6 sm:space-y-8"
      >
        {/* Header */}
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground mb-1 tracking-widest uppercase">
            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            N3XUS Control Center
          </div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground">Mission Control</h1>
          <p className="text-muted-foreground mt-1 text-sm">Paste a YouTube URL. Walk away. Wake up published.</p>
        </div>

        {/* Quick Submit */}
        <Card className="p-4 sm:p-6 border-border bg-card/80 backdrop-blur-sm">
          <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-4">New Mission</h2>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste YouTube or Facebook URL..."
              className="font-mono text-sm bg-muted border-border focus:border-primary h-11 sm:h-9"
            />

            {/* URL preview */}
            {previewLoading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
                <Loader2 className="w-3 h-3 animate-spin" /> Fetching video info…
              </div>
            )}
            {urlPreview && !previewLoading && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="flex items-center gap-3 p-2.5 rounded-md bg-muted/60 border border-border overflow-hidden"
              >
                <img
                  src={urlPreview.thumbnail}
                  alt="thumbnail"
                  className="w-20 aspect-video object-cover rounded shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
                <p className="text-xs font-medium text-foreground line-clamp-2 leading-snug">
                  {urlPreview.title}
                </p>
              </motion.div>
            )}

            <Button
              type="submit"
              disabled={createJob.isPending || !url.trim()}
              className="gap-2 bg-primary text-primary-foreground hover:bg-primary/80 font-mono w-full h-11 sm:h-9 sm:w-auto sm:self-end text-base sm:text-sm"
            >
              {createJob.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              Launch Mission
            </Button>
          </form>
          {submitError && (
            <p className="text-xs text-destructive font-mono mt-2 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0" /> {submitError}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-3">
            Or{" "}
            <Link href="/new" className="text-primary hover:underline">
              configure advanced options
            </Link>{" "}
            for publish mode and platform targeting.
          </p>
        </Card>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {statCards.map((card, i) => {
            const Icon = card.icon;
            const delta = trendFor(card.key);
            return (
              <motion.div
                key={card.label}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <Card className="p-3 sm:p-5 border-border bg-card/80 backdrop-blur-sm hover:border-primary/30 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[10px] sm:text-xs font-mono uppercase tracking-widest text-muted-foreground leading-tight">
                        {card.label}
                      </p>
                      <div className="flex items-end gap-2 mt-1.5 sm:mt-2">
                        <p className="text-2xl sm:text-3xl font-display font-bold text-foreground">
                          {statsLoading ? "—" : card.value}
                        </p>
                        {!statsLoading && <TrendBadge delta={delta} />}
                      </div>
                    </div>
                    <div className={`p-1.5 sm:p-2 rounded-md ${card.bg} shrink-0`}>
                      <Icon className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${card.color}`} />
                    </div>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>

        {/* Recent Missions */}
        <div>
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Recent Missions</h2>
            <Link href="/jobs" className="text-xs text-primary hover:underline flex items-center gap-1 font-mono">
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          {!jobs || jobs.length === 0 ? (
            <Card className="p-8 sm:p-12 border-border bg-card/80 backdrop-blur-sm text-center">
              <Activity className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">No missions launched yet. Submit a YouTube URL above to begin.</p>
            </Card>
          ) : (
            <div className="space-y-2">
              {jobs.map((job, i) => (
                <motion.div
                  key={job.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03 }}
                >
                  <Link href={`/jobs/${job.id}`}>
                    <Card className="p-3 sm:p-4 border-border bg-card/80 backdrop-blur-sm hover:border-primary/40 hover:bg-muted/30 transition-all cursor-pointer">
                      <div className="flex items-start gap-3 sm:items-center">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {job.title || job.originalTitle || job.youtubeUrl || "Untitled Mission"}
                          </p>
                          <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">
                            {job.youtubeUrl}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3 shrink-0">
                          <StatusBadge status={job.status} />
                          <span className="text-[10px] sm:text-xs text-muted-foreground font-mono whitespace-nowrap">
                            {job.createdAt ? formatDistanceToNow(new Date(job.createdAt), { addSuffix: true }) : ""}
                          </span>
                        </div>
                      </div>
                    </Card>
                  </Link>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </Layout>
  );
}
