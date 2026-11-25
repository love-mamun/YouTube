import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useCreateJob, getListJobsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useState, useCallback, useRef, useEffect } from "react";
import {
  Play, Youtube, Facebook, AlertCircle, Loader2,
  MonitorPlay, ChevronDown, CheckCircle2,
} from "lucide-react";

const QUALITY_OPTIONS = [
  { value: "360p",  label: "360p",          desc: "SD — smallest file size",       badge: "SD",  color: "bg-muted-foreground" },
  { value: "480p",  label: "480p",          desc: "SD+ — good for mobile",         badge: "SD+", color: "bg-muted-foreground" },
  { value: "720p",  label: "720p HD",       desc: "HD — standard high definition", badge: "HD",  color: "bg-yellow-500"       },
  { value: "1080p", label: "1080p Full HD", desc: "Full HD — YouTube default",     badge: "FHD", color: "bg-green-500"        },
  { value: "1440p", label: "1440p 2K",      desc: "2K — ultra sharp quality",      badge: "2K",  color: "bg-cyan-400"         },
  { value: "4k",    label: "2160p 4K",      desc: "4K UHD — maximum quality",      badge: "4K",  color: "bg-primary"          },
];

const BADGE_COLORS: Record<string, string> = {
  "360p":  "border-border text-muted-foreground",
  "480p":  "border-border text-muted-foreground",
  "720p":  "border-yellow-500/40 text-yellow-400",
  "1080p": "border-green-500/40 text-green-400",
  "1440p": "border-cyan-400/40 text-cyan-400",
  "4k":    "border-primary/40 text-primary",
};

function detectPlatform(url: string): "youtube" | "facebook" | "other" | null {
  if (!url.trim()) return null;
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  if (/facebook\.com|fb\.watch|fb\.com/i.test(url)) return "facebook";
  return "other";
}

function extractYouTubeId(url: string): string | null {
  const m = url.match(/(?:v=|youtu\.be\/|shorts\/)([^&?/]+)/);
  return m?.[1] ?? null;
}

interface UrlPreview { thumbnail: string; title: string }

export default function FourKMission() {
  const [, navigate] = useLocation();
  const [url, setUrl] = useState("");
  const [quality, setQuality] = useState("1080p");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [preview, setPreview] = useState<UrlPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const createJob = useCreateJob();

  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  const platform = detectPlatform(url);

  const fetchPreview = useCallback(async (val: string) => {
    if (!val.trim() || !/youtube\.com|youtu\.be/i.test(val)) {
      setPreview(null);
      return;
    }
    setPreviewLoading(true);
    try {
      const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(val)}&format=json`);
      if (res.ok) {
        const data = (await res.json()) as { title?: string };
        const vid = extractYouTubeId(val);
        setPreview({
          thumbnail: vid ? `https://img.youtube.com/vi/${vid}/hqdefault.jpg` : "",
          title: data.title ?? "",
        });
      } else {
        setPreview(null);
      }
    } catch {
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const handleUrlChange = (val: string) => {
    setUrl(val);
    setError(null);
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => fetchPreview(val), 600);
  };

  const selectedQuality = QUALITY_OPTIONS.find(q => q.value === quality) ?? QUALITY_OPTIONS[3];

  const canSubmit = !launching && url.trim().length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setLaunching(true);
    setError(null);
    try {
      const job = await createJob.mutateAsync({
        data: {
          youtubeUrl: url.trim(),
          publishMode: "manual",
          platforms: "youtube",
          quality,
          missionType: "4k",
        },
      });
      await queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
      navigate(`/jobs/${job.id}`);
    } catch (err) {
      setLaunching(false);
      setError((err as { message?: string })?.message ?? "Failed to launch mission");
    }
  };

  return (
    <Layout>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="max-w-2xl space-y-5 sm:space-y-6"
      >
        {/* Header */}
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground mb-1 tracking-widest uppercase">
            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            Quality Mission
          </div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground flex items-center gap-3">
            4K Mission
            <Badge className="text-xs font-mono bg-primary/10 text-primary border-primary/30 px-2 py-0.5">
              UHD
            </Badge>
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Paste a URL, pick quality — every resolution gets the full FFmpeg treatment: metadata stripped, speed-adjusted, audio pitch-shifted, watermarked. Copyright-safe. Original title &amp; description preserved for publishing.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">

          {/* URL Input */}
          <Card className="p-4 sm:p-6 border-border bg-card/80 backdrop-blur-sm space-y-4">
            <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Source Video URL</h2>

            <div className="space-y-3">
              <div className="relative">
                <Input
                  type="url"
                  placeholder="Paste YouTube or Facebook URL..."
                  value={url}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  className="font-mono text-sm bg-muted border-border focus:border-primary pr-28 h-11"
                  autoComplete="off"
                  autoFocus
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  {platform === "youtube" && (
                    <Badge variant="secondary" className="text-[10px] gap-1 bg-red-500/10 text-red-400 border-red-500/20">
                      <Youtube className="w-3 h-3" /> YouTube
                    </Badge>
                  )}
                  {platform === "facebook" && (
                    <Badge variant="secondary" className="text-[10px] gap-1 bg-blue-500/10 text-blue-400 border-blue-500/20">
                      <Facebook className="w-3 h-3" /> Facebook
                    </Badge>
                  )}
                  {platform === "other" && (
                    <Badge variant="secondary" className="text-[10px] gap-1">
                      <AlertCircle className="w-3 h-3" /> Other
                    </Badge>
                  )}
                </div>
              </div>

              {/* Preview */}
              {previewLoading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
                  <Loader2 className="w-3 h-3 animate-spin" /> Fetching preview…
                </div>
              )}
              <AnimatePresence>
                {preview && !previewLoading && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex gap-3 items-center p-3 rounded-md bg-muted/50 border border-border"
                  >
                    <img
                      src={preview.thumbnail}
                      alt="thumbnail"
                      className="w-20 h-12 object-cover rounded shrink-0 bg-muted"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-foreground line-clamp-2">{preview.title}</p>
                      <p className="text-[10px] font-mono text-muted-foreground mt-0.5">Preview loaded</p>
                    </div>
                    <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </Card>

          {/* Quality Selector */}
          <Card className="p-4 sm:p-6 border-border bg-card/80 backdrop-blur-sm space-y-3 sm:space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Download Quality</h2>
              <Badge variant="outline" className={`text-[10px] font-mono px-2 ${BADGE_COLORS[quality]}`}>
                {selectedQuality.badge}
              </Badge>
            </div>

            {/* Dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setDropdownOpen((o) => !o)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-md border border-border bg-muted hover:border-primary/50 active:scale-[0.99] transition-all text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${selectedQuality.color}`} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{selectedQuality.label}</p>
                    <p className="text-xs text-muted-foreground">{selectedQuality.desc}</p>
                  </div>
                </div>
                <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-200 ${dropdownOpen ? "rotate-180" : ""}`} />
              </button>

              <AnimatePresence>
                {dropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scaleY: 0.95 }}
                    animate={{ opacity: 1, y: 0, scaleY: 1 }}
                    exit={{ opacity: 0, y: -4, scaleY: 0.97 }}
                    transition={{ duration: 0.15 }}
                    style={{ originY: 0 }}
                    className="absolute z-30 top-full left-0 right-0 mt-1.5 rounded-md border border-border bg-card shadow-2xl overflow-hidden"
                  >
                    {QUALITY_OPTIONS.map((opt) => {
                      const isSelected = quality === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => { setQuality(opt.value); setDropdownOpen(false); }}
                          className={`w-full flex items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted ${
                            isSelected ? "bg-primary/5" : ""
                          } ${isSelected ? "border-l-2 border-l-primary" : "border-l-2 border-l-transparent"}`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${opt.color}`} />
                            <div className="min-w-0">
                              <p className={`text-sm font-medium ${isSelected ? "text-primary" : "text-foreground"}`}>
                                {opt.label}
                              </p>
                              <p className="text-xs text-muted-foreground">{opt.desc}</p>
                            </div>
                          </div>
                          <Badge variant="outline" className={`text-[10px] font-mono shrink-0 ${BADGE_COLORS[opt.value]}`}>
                            {opt.badge}
                          </Badge>
                        </button>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Pipeline info */}
            <div className="rounded-md bg-muted/40 border border-border p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">FFmpeg Pipeline</p>
                <span className="text-[10px] font-mono text-primary/70">Applied to ALL resolutions</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                {[
                  "Strip all metadata (fingerprint-safe)",
                  "Video 2% speed adjust",
                  `Scale → ${selectedQuality.label}`,
                  "Crop 2px edges",
                  "Watermark center-bottom",
                  "Audio pitch shift (copyright-safe)",
                  `Bitrate: ${quality === "4k" ? "20 Mbps" : quality === "1440p" ? "12 Mbps" : quality === "1080p" ? "8 Mbps" : quality === "720p" ? "5 Mbps" : quality === "480p" ? "2 Mbps" : "1 Mbps"}`,
                  "Preset: slow / CRF 18",
                ].map((step) => (
                  <div key={step} className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-mono">
                    <div className="w-1 h-1 rounded-full bg-primary/60 shrink-0" />
                    {step}
                  </div>
                ))}
              </div>
              <p className="text-[10px] font-mono text-muted-foreground/50 pt-0.5">
                Original title &amp; description preserved · AI generates tags &amp; hashtags
              </p>
            </div>
          </Card>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 text-xs text-destructive font-mono bg-destructive/10 border border-destructive/20 rounded-md p-3">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </div>
          )}

          {/* Launch */}
          <Button
            type="submit"
            disabled={!canSubmit}
            className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/80 font-mono font-semibold h-12 text-base"
          >
            {launching ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Launching…
              </>
            ) : (
              <>
                <MonitorPlay className="w-4 h-4" />
                Launch 4K Mission
              </>
            )}
          </Button>

          <p className="text-center text-xs text-muted-foreground font-mono">
            Quality: <span className="text-primary">{selectedQuality.label}</span>
            {" · "}Platform: YouTube
            {" · "}Mode: Manual Approval
          </p>
        </form>
      </motion.div>
    </Layout>
  );
}
