import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Telescope, TrendingUp, Search, Eye, ThumbsUp, MessageSquare,
  Loader2, AlertTriangle, ExternalLink, Zap, RefreshCw, Video,
  ArrowRight, Filter, X,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface YTVideo {
  id: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
  publishedAt: string;
  duration: string;
  tags: string[];
  statistics: { viewCount: number; likeCount: number; commentCount: number };
  url: string;
}

const TRENDING_CATEGORIES = [
  { id: "0", label: "All" },
  { id: "20", label: "Gaming" },
  { id: "28", label: "Tech" },
  { id: "10", label: "Music" },
  { id: "24", label: "Entertainment" },
  { id: "27", label: "Education" },
  { id: "25", label: "News" },
  { id: "17", label: "Sports" },
];

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function parseDuration(iso: string): string {
  if (!iso) return "";
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return "";
  const h = parseInt(m[1] || "0");
  const min = parseInt(m[2] || "0");
  const s = parseInt(m[3] || "0");
  if (h > 0) return `${h}:${String(min).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${min}:${String(s).padStart(2, "0")}`;
}

function VideoCard({ video, onImport, importing, imported }: {
  video: YTVideo;
  onImport: () => void;
  importing: boolean;
  imported: boolean;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="group flex flex-col bg-muted/20 border border-border/50 rounded-xl overflow-hidden hover:border-primary/30 transition-all"
    >
      <div className="relative">
        {video.thumbnailUrl ? (
          <img src={video.thumbnailUrl} alt="" className="w-full aspect-video object-cover" />
        ) : (
          <div className="w-full aspect-video bg-muted flex items-center justify-center">
            <Video className="w-8 h-8 text-muted-foreground" />
          </div>
        )}
        {video.duration && (
          <span className="absolute bottom-1.5 right-1.5 text-[10px] font-mono bg-black/80 text-white px-1.5 py-0.5 rounded">
            {parseDuration(video.duration)}
          </span>
        )}
        <a href={video.url} target="_blank" rel="noopener noreferrer"
          className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors">
          <ExternalLink className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
        </a>
      </div>

      <div className="p-3 flex flex-col gap-2 flex-1">
        <div>
          <p className="text-sm font-medium text-foreground line-clamp-2 leading-snug">{video.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5 font-mono">{video.channelTitle}</p>
        </div>

        <div className="flex items-center gap-3 text-xs font-mono text-muted-foreground">
          <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{formatCount(video.statistics.viewCount)}</span>
          <span className="flex items-center gap-1"><ThumbsUp className="w-3 h-3" />{formatCount(video.statistics.likeCount)}</span>
          <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{formatCount(video.statistics.commentCount)}</span>
        </div>

        {video.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {video.tags.slice(0, 4).map((tag) => (
              <span key={tag} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary/80 border border-primary/20">
                #{tag}
              </span>
            ))}
          </div>
        )}

        <div className="mt-auto pt-1">
          <Button
            size="sm"
            onClick={onImport}
            disabled={importing || imported}
            className={`w-full text-xs font-mono gap-1.5 h-8 ${imported ? "bg-green-600/20 text-green-400 border border-green-500/30" : ""}`}
            variant={imported ? "outline" : "default"}
          >
            {importing ? (
              <><Loader2 className="w-3 h-3 animate-spin" />Importing…</>
            ) : imported ? (
              <><Zap className="w-3 h-3" />Imported!</>
            ) : (
              <><Zap className="w-3 h-3" />Import to N3XUS</>
            )}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

export default function Discover() {
  const [, navigate] = useLocation();
  const [activeCategory, setActiveCategory] = useState("0");
  const [trendingVideos, setTrendingVideos] = useState<YTVideo[]>([]);
  const [loadingTrending, setLoadingTrending] = useState(true);
  const [trendingError, setTrendingError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [pendingQuery, setPendingQuery] = useState("");
  const [searchResults, setSearchResults] = useState<YTVideo[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<"relevance" | "viewCount" | "date">("relevance");

  const [importingId, setImportingId] = useState<string | null>(null);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());

  const fetchTrending = useCallback(async (categoryId: string) => {
    setLoadingTrending(true);
    setTrendingError(null);
    try {
      const res = await fetch(`${BASE}/api/youtube/trending?categoryId=${categoryId}&maxResults=20`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Error ${res.status}`);
      }
      const data = await res.json();
      setTrendingVideos(data.videos || []);
    } catch (e) {
      setTrendingError(e instanceof Error ? e.message : "Failed to load trending");
    } finally {
      setLoadingTrending(false);
    }
  }, []);

  useEffect(() => { fetchTrending(activeCategory); }, [activeCategory, fetchTrending]);

  const handleSearch = useCallback(async (q?: string) => {
    const query = (q ?? pendingQuery).trim();
    if (!query) return;
    setSearchQuery(query);
    setLoadingSearch(true);
    setSearchError(null);
    setSearchResults([]);
    try {
      const res = await fetch(`${BASE}/api/youtube/search?q=${encodeURIComponent(query)}&maxResults=15&order=${sortOrder}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Error ${res.status}`);
      }
      const data = await res.json();
      setSearchResults(data.videos || []);
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoadingSearch(false);
    }
  }, [pendingQuery, sortOrder]);

  const handleImport = async (video: YTVideo) => {
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
    } catch {
      // non-fatal
    } finally {
      setImportingId(null);
    }
  };

  const globalError = trendingError?.includes("token") || trendingError?.includes("connect") || trendingError?.includes("Settings");

  return (
    <Layout>
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="space-y-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-semibold tracking-tight text-foreground">Discover</h1>
          <p className="text-muted-foreground text-sm mt-1">Explore trending content and research competitors — import any video to N3XUS instantly.</p>
        </div>

        {globalError && (
          <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-400">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium mb-1">YouTube not connected</p>
              <p className="text-xs text-red-400/80">{trendingError}</p>
              <Button size="sm" variant="outline" className="mt-3 text-xs gap-1.5" onClick={() => navigate("/settings")}>
                Connect Channel <ArrowRight className="w-3 h-3" />
              </Button>
            </div>
          </div>
        )}

        <Card className="p-5 border-border bg-card/80 backdrop-blur-sm space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Search className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-display font-semibold text-foreground">Competitor Research</h2>
              <p className="text-xs text-muted-foreground">Search YouTube and import top-performing videos for content analysis</p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder="Search YouTube… e.g. 'AI tutorial 2024', 'gaming highlights'"
              value={pendingQuery}
              onChange={(e) => setPendingQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="flex-1 font-mono text-sm bg-muted/50 border-border min-h-[44px] h-11"
            />
            <div className="flex gap-1.5">
              {(["relevance", "viewCount", "date"] as const).map((o) => (
                <button key={o} onClick={() => setSortOrder(o)}
                  className={`text-xs font-medium px-3 min-h-[44px] rounded-lg border transition-colors ${
                    sortOrder === o ? "bg-primary/15 text-primary border-primary/40" : "text-muted-foreground border-border hover:text-foreground"
                  }`}>
                  {o === "relevance" ? "Relevant" : o === "viewCount" ? "Top" : "Latest"}
                </button>
              ))}
              <Button onClick={() => handleSearch()} disabled={loadingSearch || !pendingQuery.trim()} className="gap-2 font-medium text-xs min-h-[44px] h-11 px-4 bg-primary text-primary-foreground hover:bg-primary/90">
                {loadingSearch ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                Search
              </Button>
            </div>
          </div>

          <AnimatePresence>
            {searchError && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />{searchError}
              </motion.div>
            )}
          </AnimatePresence>

          {searchResults.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-mono text-muted-foreground">
                  {searchResults.length} results for "<span className="text-foreground">{searchQuery}</span>"
                </p>
                <button onClick={() => { setSearchResults([]); setPendingQuery(""); setSearchQuery(""); }}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
                  <X className="w-3 h-3" /> Clear
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {searchResults.map((v) => (
                  <VideoCard key={v.id} video={v}
                    onImport={() => handleImport(v)}
                    importing={importingId === v.id}
                    imported={importedIds.has(v.id)} />
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card className="p-5 border-border bg-card/80 backdrop-blur-sm space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <TrendingUp className="w-4 h-4 text-primary" />
              </div>
              <div>
                <h2 className="text-sm font-display font-semibold text-foreground">Trending Now</h2>
                <p className="text-xs text-muted-foreground">Most popular videos on YouTube right now</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => fetchTrending(activeCategory)} disabled={loadingTrending}
              className="gap-1.5 font-mono text-xs text-muted-foreground">
              <RefreshCw className={`w-3.5 h-3.5 ${loadingTrending ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          <div className="flex gap-2 flex-wrap">
            {TRENDING_CATEGORIES.map((cat) => (
              <button key={cat.id} onClick={() => setActiveCategory(cat.id)}
                className={`text-xs font-mono px-3 py-1.5 rounded-full border transition-all ${
                  activeCategory === cat.id
                    ? "bg-primary/20 text-primary border-primary/40 shadow-sm"
                    : "text-muted-foreground border-border/50 hover:border-border hover:text-foreground"
                }`}>
                {cat.label}
              </button>
            ))}
          </div>

          {trendingError && !globalError ? (
            <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
              <AlertTriangle className="w-3.5 h-3.5" />{trendingError}
            </div>
          ) : loadingTrending ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-border/30 overflow-hidden animate-pulse">
                  <div className="aspect-video bg-muted" />
                  <div className="p-3 space-y-2">
                    <div className="h-3 bg-muted rounded w-3/4" />
                    <div className="h-3 bg-muted rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <AnimatePresence>
                {trendingVideos.map((v, i) => (
                  <motion.div key={v.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                    <VideoCard
                      video={v}
                      onImport={() => handleImport(v)}
                      importing={importingId === v.id}
                      imported={importedIds.has(v.id)}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
              {trendingVideos.length === 0 && (
                <div className="col-span-full text-center py-10 text-muted-foreground text-sm">No trending videos found for this category.</div>
              )}
            </div>
          )}
        </Card>
      </motion.div>
    </Layout>
  );
}
