import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Youtube, Users, Eye, ThumbsUp, MessageSquare, RefreshCw,
  Loader2, AlertTriangle, ExternalLink, TrendingUp, Video,
  CheckCircle2, Zap, BarChart3, Upload, Star, Play,
  ArrowRight, Info,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ChannelInfo {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  customUrl: string;
  publishedAt: string;
  statistics: { subscriberCount: number; viewCount: number; videoCount: number };
  healthScore: number;
  healthBreakdown: { subscribers: number; viewRatio: number; profile: number; uploads: number };
}

interface YTVideo {
  id: string;
  title: string;
  thumbnailUrl: string;
  publishedAt: string;
  duration: string;
  privacyStatus: string;
  tags: string[];
  statistics: { viewCount: number; likeCount: number; commentCount: number };
  url: string;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function parseDuration(iso: string): string {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return "";
  const h = parseInt(m[1] || "0");
  const min = parseInt(m[2] || "0");
  const s = parseInt(m[3] || "0");
  if (h > 0) return `${h}:${String(min).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${min}:${String(s).padStart(2, "0")}`;
}

function HealthMeter({ score }: { score: number }) {
  const color = score >= 75 ? "#00d4ff" : score >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-center">
        <span className="text-xs font-mono text-muted-foreground">Channel Health</span>
        <span className="text-lg font-bold font-mono" style={{ color }}>{score}/100</span>
      </div>
      <div className="h-2 rounded-full bg-muted/60 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
        />
      </div>
    </div>
  );
}

function HealthBreakdown({ breakdown }: { breakdown: ChannelInfo["healthBreakdown"] }) {
  const items = [
    { label: "Subscribers", score: breakdown.subscribers, max: 25, icon: Users },
    { label: "View Ratio", score: breakdown.viewRatio, max: 25, icon: Eye },
    { label: "Profile", score: breakdown.profile, max: 25, icon: Star },
    { label: "Uploads", score: breakdown.uploads, max: 25, icon: Upload },
  ];
  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map(({ label, score, max, icon: Icon }) => (
        <div key={label} className="flex flex-col gap-1 p-2 rounded-md bg-muted/30 border border-border/40">
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
            <Icon className="w-3 h-3" />{label}
          </div>
          <div className="flex items-center justify-between">
            <div className="flex-1 h-1.5 rounded-full bg-muted/60 overflow-hidden mr-2">
              <div className="h-full rounded-full bg-primary" style={{ width: `${(score / max) * 100}%` }} />
            </div>
            <span className="text-xs font-mono font-semibold text-foreground">{score}/{max}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function VideoRow({ video, onOptimize, importing }: {
  video: YTVideo;
  onOptimize: (v: YTVideo) => void;
  importing: boolean;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex gap-3 p-3 rounded-lg border border-border/50 bg-muted/20 hover:bg-muted/40 transition-colors group"
    >
      <div className="relative shrink-0">
        {video.thumbnailUrl ? (
          <img src={video.thumbnailUrl} alt="" className="w-24 h-14 object-cover rounded" />
        ) : (
          <div className="w-24 h-14 rounded bg-muted flex items-center justify-center">
            <Video className="w-5 h-5 text-muted-foreground" />
          </div>
        )}
        {video.duration && (
          <span className="absolute bottom-1 right-1 text-[10px] font-mono bg-black/80 text-white px-1 rounded">
            {parseDuration(video.duration)}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <a href={video.url} target="_blank" rel="noopener noreferrer"
          className="text-sm font-medium text-foreground hover:text-primary line-clamp-2 leading-snug transition-colors">
          {video.title}
        </a>
        <div className="flex items-center gap-3 mt-1.5 text-xs font-mono text-muted-foreground">
          <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{formatCount(video.statistics.viewCount)}</span>
          <span className="flex items-center gap-1"><ThumbsUp className="w-3 h-3" />{formatCount(video.statistics.likeCount)}</span>
          <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{formatCount(video.statistics.commentCount)}</span>
          {video.privacyStatus !== "public" && (
            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">{video.privacyStatus}</Badge>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground/60 mt-0.5">
          {new Date(video.publishedAt).toLocaleDateString()}
        </p>
      </div>
      <div className="flex items-center shrink-0">
        <Button size="sm" variant="outline" onClick={() => onOptimize(video)} disabled={importing}
          className="text-xs font-mono gap-1.5 h-7 opacity-0 group-hover:opacity-100 transition-opacity">
          {importing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
          Optimize
        </Button>
      </div>
    </motion.div>
  );
}

export default function Channel() {
  const [, navigate] = useLocation();
  const [channelInfo, setChannelInfo] = useState<ChannelInfo | null>(null);
  const [videos, setVideos] = useState<YTVideo[]>([]);
  const [loadingChannel, setLoadingChannel] = useState(true);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<"views" | "likes" | "comments" | "date">("views");

  const fetchChannel = useCallback(async () => {
    setLoadingChannel(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/youtube/channel-info`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Error ${res.status}`);
      }
      setChannelInfo(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load channel");
    } finally {
      setLoadingChannel(false);
    }
  }, []);

  const fetchVideos = useCallback(async (pageToken?: string) => {
    setLoadingVideos(true);
    try {
      const params = new URLSearchParams({ maxResults: "25" });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await fetch(`${BASE}/api/youtube/my-videos?${params}`);
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = await res.json();
      setVideos((prev) => pageToken ? [...prev, ...data.videos] : data.videos);
      setNextPageToken(data.nextPageToken);
    } catch { /* non-fatal */ } finally {
      setLoadingVideos(false);
    }
  }, []);

  useEffect(() => {
    fetchChannel();
    fetchVideos();
  }, [fetchChannel, fetchVideos]);

  const handleOptimize = async (video: YTVideo) => {
    setImportingId(video.id);
    try {
      const res = await fetch(`${BASE}/api/youtube/import-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: video.id, title: video.title }),
      });
      if (!res.ok) throw new Error("Import failed");
      const job = await res.json();
      setImportedIds((prev) => new Set([...prev, video.id]));
      navigate(`/jobs/${job.id}`);
    } finally {
      setImportingId(null);
    }
  };

  const sortedVideos = [...videos].sort((a, b) => {
    if (sortBy === "views") return b.statistics.viewCount - a.statistics.viewCount;
    if (sortBy === "likes") return b.statistics.likeCount - a.statistics.likeCount;
    if (sortBy === "comments") return b.statistics.commentCount - a.statistics.commentCount;
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  });

  return (
    <Layout>
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="space-y-8">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground mb-1 tracking-widest uppercase">
            <div className="w-1.5 h-1.5 rounded-full bg-primary" />YouTube Data API v3
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground">Channel Hub</h1>
              <p className="text-muted-foreground text-sm mt-1">Your channel analytics, health score, and video optimizer.</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => { fetchChannel(); fetchVideos(); }}
              disabled={loadingChannel} className="gap-2 font-mono text-xs shrink-0">
              <RefreshCw className={`w-3.5 h-3.5 ${loadingChannel ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-400">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium mb-1">{error.includes("token") || error.includes("connect") ? "YouTube not connected" : "Error"}</p>
              <p className="text-xs text-red-400/80">{error}</p>
              {(error.includes("token") || error.includes("connect") || error.includes("Settings")) && (
                <Button size="sm" variant="outline" className="mt-3 text-xs gap-1.5" onClick={() => navigate("/settings")}>
                  Go to Settings <ArrowRight className="w-3 h-3" />
                </Button>
              )}
            </div>
          </div>
        )}

        {loadingChannel ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : channelInfo && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card className="p-5 border-border bg-card/80 backdrop-blur-sm lg:col-span-1 space-y-4">
                <div className="flex items-center gap-3">
                  {channelInfo.thumbnailUrl ? (
                    <img src={channelInfo.thumbnailUrl} alt="" className="w-14 h-14 rounded-full border-2 border-primary/30 object-cover" />
                  ) : (
                    <div className="w-14 h-14 rounded-full bg-primary/20 flex items-center justify-center">
                      <Youtube className="w-6 h-6 text-primary" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <h2 className="font-display font-bold text-foreground truncate">{channelInfo.title}</h2>
                    {channelInfo.customUrl && (
                      <a href={`https://www.youtube.com/${channelInfo.customUrl}`} target="_blank" rel="noopener noreferrer"
                        className="text-xs font-mono text-primary hover:underline flex items-center gap-1">
                        {channelInfo.customUrl} <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  {[
                    { label: "Subscribers", value: formatCount(channelInfo.statistics.subscriberCount), icon: Users },
                    { label: "Total Views", value: formatCount(channelInfo.statistics.viewCount), icon: Eye },
                    { label: "Videos", value: channelInfo.statistics.videoCount.toLocaleString(), icon: Video },
                  ].map(({ label, value, icon: Icon }) => (
                    <div key={label} className="p-2 rounded-lg bg-muted/40 border border-border/40">
                      <Icon className="w-3.5 h-3.5 text-primary mx-auto mb-1" />
                      <p className="text-xs font-bold font-mono text-foreground">{value}</p>
                      <p className="text-[10px] text-muted-foreground">{label}</p>
                    </div>
                  ))}
                </div>

                <HealthMeter score={channelInfo.healthScore} />
                <HealthBreakdown breakdown={channelInfo.healthBreakdown} />

                <div className={`flex items-center gap-2 text-xs rounded-lg px-3 py-2 ${
                  channelInfo.healthScore >= 75 ? "bg-green-500/10 text-green-400 border border-green-500/20" :
                  channelInfo.healthScore >= 50 ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" :
                  "bg-red-500/10 text-red-400 border border-red-500/20"
                }`}>
                  <Info className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {channelInfo.healthScore >= 75 ? "Channel is performing well. Keep publishing consistently." :
                     channelInfo.healthScore >= 50 ? "Room to grow. Optimize descriptions and upload more." :
                     "Low health. Focus on consistency and complete profile."}
                  </span>
                </div>
              </Card>

              <Card className="p-5 border-border bg-card/80 backdrop-blur-sm lg:col-span-2 space-y-4">
                <div className="flex items-center gap-3">
                  <BarChart3 className="w-5 h-5 text-primary" />
                  <div>
                    <h2 className="font-display font-semibold text-foreground text-sm">Performance Overview</h2>
                    <p className="text-xs text-muted-foreground">Based on your channel's current data</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {[
                    {
                      label: "Avg Views / Video",
                      value: channelInfo.statistics.videoCount > 0
                        ? formatCount(Math.round(channelInfo.statistics.viewCount / channelInfo.statistics.videoCount))
                        : "—",
                      icon: Play, color: "text-cyan-400",
                    },
                    {
                      label: "Views / Subscriber",
                      value: channelInfo.statistics.subscriberCount > 0
                        ? (channelInfo.statistics.viewCount / channelInfo.statistics.subscriberCount).toFixed(1) + "x"
                        : "—",
                      icon: TrendingUp, color: "text-green-400",
                    },
                    {
                      label: "Channel Since",
                      value: channelInfo.publishedAt ? new Date(channelInfo.publishedAt).getFullYear().toString() : "—",
                      icon: Star, color: "text-yellow-400",
                    },
                    {
                      label: "Health Score",
                      value: `${channelInfo.healthScore} / 100`,
                      icon: CheckCircle2,
                      color: channelInfo.healthScore >= 75 ? "text-green-400" : channelInfo.healthScore >= 50 ? "text-amber-400" : "text-red-400",
                    },
                  ].map(({ label, value, icon: Icon, color }) => (
                    <div key={label} className="p-4 rounded-xl border border-border/50 bg-muted/30 flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-muted/60 flex items-center justify-center shrink-0">
                        <Icon className={`w-4 h-4 ${color}`} />
                      </div>
                      <div>
                        <p className="text-base font-bold font-mono text-foreground">{value}</p>
                        <p className="text-[11px] text-muted-foreground">{label}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-xs text-muted-foreground">
                  <span className="font-semibold text-primary">Tip: </span>
                  {channelInfo.statistics.subscriberCount > 0 && channelInfo.statistics.videoCount > 0 && (
                    channelInfo.statistics.viewCount / channelInfo.statistics.videoCount < channelInfo.statistics.subscriberCount * 0.1
                      ? "Your average views per video is below 10% of your subscriber count. Improve titles and thumbnails for better CTR."
                      : "Good engagement ratio! Keep optimizing with N3XUS to maintain momentum."
                  )}
                </div>
              </Card>
            </div>

            <Card className="p-5 border-border bg-card/80 backdrop-blur-sm space-y-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <Video className="w-5 h-5 text-primary" />
                  <div>
                    <h2 className="font-display font-semibold text-foreground text-sm">My Videos</h2>
                    <p className="text-xs text-muted-foreground">Click Optimize to re-generate AI content for any video</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-muted-foreground">Sort:</span>
                  {(["views", "likes", "comments", "date"] as const).map((s) => (
                    <button key={s} onClick={() => setSortBy(s)}
                      className={`text-xs font-mono px-2 py-1 rounded transition-colors ${
                        sortBy === s ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
                      }`}>
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {loadingVideos && videos.length === 0 ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                </div>
              ) : (
                <div className="space-y-2">
                  <AnimatePresence>
                    {sortedVideos.map((video) => (
                      <VideoRow
                        key={video.id}
                        video={video}
                        onOptimize={handleOptimize}
                        importing={importingId === video.id}
                      />
                    ))}
                  </AnimatePresence>
                  {sortedVideos.length === 0 && (
                    <div className="text-center py-10 text-muted-foreground text-sm">No videos found on this channel.</div>
                  )}
                </div>
              )}

              {nextPageToken && (
                <Button variant="outline" className="w-full font-mono text-xs gap-2" onClick={() => fetchVideos(nextPageToken)} disabled={loadingVideos}>
                  {loadingVideos ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  Load More Videos
                </Button>
              )}
            </Card>
          </>
        )}
      </motion.div>
    </Layout>
  );
}
