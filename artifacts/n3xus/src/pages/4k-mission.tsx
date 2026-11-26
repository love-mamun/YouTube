import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useCreateJob, getListJobsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useState, useCallback, useRef } from "react";
import {
  Youtube,
  Facebook,
  AlertCircle,
  Loader2,
  MonitorPlay,
  CheckCircle2,
  Video,
} from "lucide-react";

const QUALITY_OPTIONS = [
  {
    value: "360p",
    label: "360p SD",
    desc: "Smallest file size",
    bitrate: "1 Mbps",
  },
  {
    value: "480p",
    label: "480p SD+",
    desc: "Compact mobile format",
    bitrate: "2 Mbps",
  },
  {
    value: "720p",
    label: "720p HD",
    desc: "Standard high definition",
    bitrate: "5 Mbps",
  },
  {
    value: "1080p",
    label: "1080p Full HD",
    desc: "YouTube standard crisp HD",
    bitrate: "8 Mbps",
  },
  {
    value: "1440p",
    label: "1440p 2K",
    desc: "High-density 2K master",
    bitrate: "16 Mbps",
  },
  {
    value: "4k",
    label: "2160p 4K UHD",
    desc: "Maximum clarity master",
    bitrate: "35 Mbps",
  },
] as const;

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

interface UrlPreview {
  thumbnail: string;
  title: string;
}

export default function FourKMission() {
  const [, navigate] = useLocation();
  const [url, setUrl] = useState("");
  const [quality, setQuality] = useState("1080p");
  const [preview, setPreview] = useState<UrlPreview | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const createJob = useCreateJob();
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const platform = detectPlatform(url);

  const fetchPreview = useCallback(async (val: string) => {
    setPreviewFailed(false);
    if (!val.trim() || !/youtube\.com|youtu\.be/i.test(val)) {
      setPreview(null);
      return;
    }
    setPreviewLoading(true);
    try {
      const res = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(val)}&format=json`
      );
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

  const selectedQuality =
    QUALITY_OPTIONS.find((q) => q.value === quality) ?? QUALITY_OPTIONS[3];

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
          quality: quality as "360p" | "480p" | "720p" | "1080p" | "1440p" | "4k",
          missionType: "4k",
        },
      });
      await queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
      navigate(`/jobs/${job.id}`);
    } catch (err) {
      setLaunching(false);
      setError(
        (err as { message?: string })?.message ?? "Failed to launch mission"
      );
    }
  };

  return (
    <Layout>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="space-y-6"
      >
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-semibold tracking-tight text-foreground">
            4K Studio
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Every selected resolution runs through the FFmpeg pipeline: metadata strip, subtle speed and pitch adjustment, and watermark overlay while preserving the original title and description.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start"
        >
          {/* Left Studio Inputs */}
          <div className="space-y-5 min-w-0">
            <Card className="p-4 sm:p-6 border-border bg-card space-y-4">
              <div>
                <h2 className="text-base font-display font-semibold text-foreground">
                  Source Video URL
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Paste a YouTube or Facebook link to prepare high-bitrate FFmpeg processing.
                </p>
              </div>

              <div className="space-y-3">
                <div className="relative">
                  <Input
                    type="url"
                    placeholder="Paste YouTube or Facebook URL..."
                    value={url}
                    onChange={(e) => handleUrlChange(e.target.value)}
                    className="font-mono text-sm bg-muted/60 border-border focus:border-primary pr-28 min-h-[44px] h-11"
                    autoComplete="off"
                    autoFocus
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
                    {platform === "youtube" && (
                      <>
                        <Youtube className="w-3.5 h-3.5 text-red-500" />
                        <span>YouTube</span>
                      </>
                    )}
                    {platform === "facebook" && (
                      <>
                        <Facebook className="w-3.5 h-3.5 text-blue-500" />
                        <span>Facebook</span>
                      </>
                    )}
                    {platform === "other" && (
                      <>
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>URL</span>
                      </>
                    )}
                  </div>
                </div>

                {previewLoading && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />{" "}
                    Fetching preview…
                  </div>
                )}

                <AnimatePresence>
                  {preview && !previewLoading && (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="flex gap-3 items-center p-3 rounded-lg bg-muted/40"
                    >
                      {preview.thumbnail && !previewFailed ? (
                        <img
                          src={preview.thumbnail}
                          alt={preview.title || "Preview"}
                          className="w-24 aspect-video object-cover rounded shrink-0 bg-muted"
                          onError={() => setPreviewFailed(true)}
                        />
                      ) : (
                        <div className="w-24 aspect-video rounded shrink-0 bg-muted flex items-center justify-center text-muted-foreground">
                          <Video className="w-4 h-4" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground line-clamp-2 leading-snug">
                          {preview.title}
                        </p>
                        <p className="text-xs font-mono text-muted-foreground mt-0.5">
                          Ready for {selectedQuality.label}
                        </p>
                      </div>
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </Card>

            {/* Target Resolution Grid */}
            <Card className="p-4 sm:p-6 border-border bg-card space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-display font-semibold text-foreground">
                    Target Resolution
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Select output frame scale and target video bitrate.
                  </p>
                </div>
                <span className="text-xs font-mono tabular-nums text-primary">
                  {selectedQuality.bitrate}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {QUALITY_OPTIONS.map((opt) => {
                  const isSelected = quality === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setQuality(opt.value)}
                      className={`text-left p-3.5 rounded-lg border transition-colors min-h-[60px] ${
                        isSelected
                          ? "border-primary bg-primary/10"
                          : "border-border bg-muted/25 hover:border-muted-foreground/40 hover:bg-muted/40"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-sm font-medium ${
                            isSelected ? "text-primary" : "text-foreground"
                          }`}
                        >
                          {opt.label}
                        </span>
                        <span className="text-xs font-mono tabular-nums text-muted-foreground">
                          {opt.bitrate}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {opt.desc}
                      </p>
                    </button>
                  );
                })}
              </div>
            </Card>
          </div>

          {/* Right Pipeline Spec & Launch Column */}
          <Card className="p-4 sm:p-5 border-border bg-card space-y-4 lg:sticky lg:top-8">
            <div>
              <h2 className="text-base font-display font-semibold text-foreground">
                FFmpeg Pipeline Spec
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Applied automatically across all selected resolutions.
              </p>
            </div>

            <div className="divide-y divide-border text-sm">
              <div className="py-2.5 flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Resolution</span>
                <span className="font-mono font-medium text-foreground">
                  {selectedQuality.label}
                </span>
              </div>
              <div className="py-2.5 flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Target Bitrate</span>
                <span className="font-mono tabular-nums font-medium text-foreground">
                  {selectedQuality.bitrate}
                </span>
              </div>
              <div className="py-2.5 flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Video Transform</span>
                <span className="font-mono text-xs text-foreground">
                  2% speed · 2px crop
                </span>
              </div>
              <div className="py-2.5 flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Audio Transform</span>
                <span className="font-mono text-xs text-foreground">
                  Pitch shift · normalized
                </span>
              </div>
              <div className="py-2.5 flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Metadata</span>
                <span className="font-mono text-xs text-foreground">
                  Stripped · clean ID
                </span>
              </div>
              <div className="py-2.5 flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Watermark</span>
                <span className="font-mono text-xs text-foreground">
                  Dual-corner logo
                </span>
              </div>
              <div className="py-2.5 flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Review Mode</span>
                <span className="font-medium text-foreground">
                  Manual Approval
                </span>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/25 rounded-lg p-3">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              disabled={!canSubmit}
              className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-medium min-h-[48px] h-12 text-sm"
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
          </Card>
        </form>
      </motion.div>
    </Layout>
  );
}
