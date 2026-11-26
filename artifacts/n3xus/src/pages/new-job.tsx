import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useCreateJob, getListJobsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useState, useCallback, useRef } from "react";
import {
  Play,
  Youtube,
  Facebook,
  Clock,
  Zap,
  Hand,
  Loader2,
  Clapperboard,
  AlertCircle,
  Plus,
  X,
  CheckCircle2,
  Video,
} from "lucide-react";

const QUALITY_OPTIONS = [
  { value: "none", label: "No Download", desc: "Metadata & AI copy only", tag: "Fastest" },
  { value: "360p", label: "360p SD", desc: "Compact file size", tag: null },
  { value: "480p", label: "480p SD+", desc: "Standard definition", tag: null },
  { value: "720p", label: "720p HD", desc: "Balanced HD stream", tag: "Recommended" },
  { value: "1080p", label: "1080p Full HD", desc: "Crisp full HD stream", tag: null },
  { value: "1440p", label: "1440p 2K", desc: "High-detail 2K stream", tag: null },
  { value: "4k", label: "2160p 4K", desc: "Ultra HD source stream", tag: "4K" },
] as const;

const CODEC_OPTIONS = [
  { value: "any", label: "Auto", desc: "Best available stream" },
  { value: "av1", label: "AV1", desc: "Smallest file size" },
  { value: "vp9", label: "VP9", desc: "High quality & compatibility" },
  { value: "h264", label: "H.264", desc: "Universal playback" },
] as const;

const PLATFORM_OPTIONS = [
  {
    id: "youtube",
    label: "YouTube",
    desc: "Standard video upload",
    icon: Youtube,
    color: "text-red-500",
  },
  {
    id: "youtube-shorts",
    label: "YouTube Shorts",
    desc: "Vertical short-form (≤60s) · adds #Shorts",
    icon: Clapperboard,
    color: "text-red-400",
  },
  {
    id: "facebook",
    label: "Facebook",
    desc: "Facebook Page video post",
    icon: Facebook,
    color: "text-blue-500",
  },
];

const PUBLISH_MODES = [
  {
    value: "auto",
    label: "Auto Publish",
    desc: "Publish immediately once processing completes",
    icon: Zap,
  },
  {
    value: "scheduled",
    label: "Scheduled",
    desc: "Publish automatically at a scheduled date & time",
    icon: Clock,
  },
  {
    value: "manual",
    label: "Manual Approval",
    desc: "Review title, tags, and thumbnail before publishing",
    icon: Hand,
  },
];

function detectPlatform(url: string): "youtube" | "facebook" | "other" | null {
  if (!url.trim()) return null;
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  if (/facebook\.com|fb\.watch|fb\.com/i.test(url)) return "facebook";
  return "other";
}

function PlatformCaption({ url }: { url: string }) {
  const p = detectPlatform(url);
  if (!p) return null;
  if (p === "youtube") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
        <Youtube className="w-3.5 h-3.5 text-red-500" /> YouTube detected
      </span>
    );
  }
  if (p === "facebook") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
        <Facebook className="w-3.5 h-3.5 text-blue-500" /> Facebook detected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
      <AlertCircle className="w-3.5 h-3.5" /> External video URL
    </span>
  );
}

interface UrlPreview {
  thumbnail: string;
  title: string;
}

type UrlStatus = "idle" | "launching" | "done" | "error";
interface UrlEntry {
  id: number;
  value: string;
  status: UrlStatus;
  error?: string;
  preview?: UrlPreview;
  previewFailed?: boolean;
  previewLoading?: boolean;
}

let nextId = 1;

function extractYouTubeId(url: string): string | null {
  const m = url.match(/(?:v=|youtu\.be\/|shorts\/)([^&?/]+)/);
  return m?.[1] ?? null;
}

const LS_PLATFORMS = "n3xus_platforms";
const LS_MODE = "n3xus_publishMode";

function loadSavedPlatforms(): string[] {
  try {
    const s = localStorage.getItem(LS_PLATFORMS);
    if (s) {
      const p = JSON.parse(s);
      if (Array.isArray(p) && p.length) return p;
    }
  } catch {
    /* noop */
  }
  return ["youtube"];
}

function loadSavedMode(): string {
  return localStorage.getItem(LS_MODE) || "manual";
}

export default function NewJob() {
  const [, navigate] = useLocation();
  const [urls, setUrls] = useState<UrlEntry[]>([
    { id: nextId++, value: "", status: "idle" },
  ]);
  const [quality, setQuality] = useState<string>("none");
  const [codec, setCodec] = useState<string>("any");
  const [publishMode, setPublishMode] = useState<string>(loadSavedMode);
  const [platforms, setPlatforms] = useState<string[]>(loadSavedPlatforms);
  const [scheduledAt, setScheduledAt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const previewTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const queryClient = useQueryClient();
  const createJob = useCreateJob();

  const addUrl = () =>
    setUrls((prev) => [...prev, { id: nextId++, value: "", status: "idle" }]);

  const removeUrl = (id: number) => {
    clearTimeout(previewTimers.current[id]);
    setUrls((prev) => prev.filter((u) => u.id !== id));
  };

  const fetchPreview = (id: number, value: string) => {
    clearTimeout(previewTimers.current[id]);
    if (!value.trim() || !/youtube\.com|youtu\.be/i.test(value)) {
      setUrls((prev) =>
        prev.map((u) =>
          u.id === id
            ? { ...u, preview: undefined, previewFailed: false, previewLoading: false }
            : u
        )
      );
      return;
    }
    setUrls((prev) =>
      prev.map((u) =>
        u.id === id ? { ...u, previewLoading: true, previewFailed: false } : u
      )
    );
    previewTimers.current[id] = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://www.youtube.com/oembed?url=${encodeURIComponent(value)}&format=json`
        );
        if (res.ok) {
          const data = (await res.json()) as {
            title?: string;
            thumbnail_url?: string;
          };
          const vid = extractYouTubeId(value);
          setUrls((prev) =>
            prev.map((u) =>
              u.id === id
                ? {
                    ...u,
                    previewLoading: false,
                    preview: {
                      thumbnail: vid
                        ? `https://img.youtube.com/vi/${vid}/hqdefault.jpg`
                        : data.thumbnail_url ?? "",
                      title: data.title ?? "",
                    },
                  }
                : u
            )
          );
        } else {
          setUrls((prev) =>
            prev.map((u) =>
              u.id === id
                ? { ...u, previewLoading: false, preview: undefined }
                : u
            )
          );
        }
      } catch {
        setUrls((prev) =>
          prev.map((u) =>
            u.id === id ? { ...u, previewLoading: false, preview: undefined } : u
          )
        );
      }
    }, 600);
  };

  const setUrlValue = (id: number, value: string) => {
    setUrls((prev) =>
      prev.map((u) =>
        u.id === id ? { ...u, value, status: "idle", error: undefined } : u
      )
    );
    fetchPreview(id, value);
  };

  const togglePlatform = (p: string) => {
    setPlatforms((prev) => {
      const next = prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p];
      localStorage.setItem(LS_PLATFORMS, JSON.stringify(next));
      return next;
    });
  };

  const handleModeChange = (mode: string) => {
    setPublishMode(mode);
    localStorage.setItem(LS_MODE, mode);
  };

  const validUrls = urls.filter((u) => u.value.trim());
  const canSubmit = !isSubmitting && validUrls.length > 0 && platforms.length > 0;

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;
      setIsSubmitting(true);
      setGlobalError(null);

      let successCount = 0;
      let lastJobId: number | null = null;

      for (const entry of validUrls) {
        setUrls((prev) =>
          prev.map((u) =>
            u.id === entry.id ? { ...u, status: "launching" } : u
          )
        );
        try {
          const job = await createJob.mutateAsync({
            data: {
              youtubeUrl: entry.value.trim(),
              publishMode: publishMode as "auto" | "scheduled" | "manual",
              platforms: platforms.join(","),
              scheduledAt: scheduledAt || null,
              ...(quality !== "none"
                ? { quality: quality as "360p" | "480p" | "720p" | "1080p" | "1440p" | "4k" }
                : {}),
              ...(quality !== "none" && codec !== "any"
                ? { codec: codec as "av1" | "vp9" | "h264" }
                : {}),
              missionType: "normal",
            },
          });
          setUrls((prev) =>
            prev.map((u) => (u.id === entry.id ? { ...u, status: "done" } : u))
          );
          lastJobId = job.id;
          successCount++;
        } catch (err) {
          const msg =
            (err as { message?: string })?.message ?? "Failed to launch";
          setUrls((prev) =>
            prev.map((u) =>
              u.id === entry.id ? { ...u, status: "error", error: msg } : u
            )
          );
        }
      }

      await queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
      setIsSubmitting(false);

      if (successCount > 0) {
        if (successCount === 1 && lastJobId) navigate(`/jobs/${lastJobId}`);
        else navigate("/jobs");
      }
    },
    [
      canSubmit,
      validUrls,
      quality,
      codec,
      publishMode,
      platforms,
      scheduledAt,
      createJob,
      queryClient,
      navigate,
    ]
  );

  const completedCount = urls.filter((u) => u.status === "done").length;
  const errorCount = urls.filter((u) => u.status === "error").length;
  const selectedQualityObj =
    QUALITY_OPTIONS.find((q) => q.value === quality) ?? QUALITY_OPTIONS[0];
  const selectedCodecObj =
    CODEC_OPTIONS.find((c) => c.value === codec) ?? CODEC_OPTIONS[0];
  const selectedModeObj =
    PUBLISH_MODES.find((m) => m.value === publishMode) ?? PUBLISH_MODES[2];

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
            New Mission
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Queue one or more video URLs, choose download parameters, and configure publishing targets.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start"
        >
          {/* Left Configuration Column */}
          <div className="space-y-5 min-w-0">
            {/* Source Video URLs */}
            <Card className="p-4 sm:p-6 border-border bg-card space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-display font-semibold text-foreground">
                    Source Video URLs
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Supports YouTube videos, YouTube Shorts, and Facebook videos.
                  </p>
                </div>
                {urls.length > 1 && (
                  <span className="text-xs font-mono tabular-nums text-muted-foreground">
                    {urls.length} links
                  </span>
                )}
              </div>

              <div className="space-y-3">
                <AnimatePresence initial={false}>
                  {urls.map((entry, idx) => (
                    <motion.div
                      key={entry.id}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.16 }}
                      className="overflow-hidden space-y-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono tabular-nums text-muted-foreground w-5 text-right shrink-0">
                          {idx + 1}.
                        </span>
                        <Input
                          value={entry.value}
                          onChange={(e) => setUrlValue(entry.id, e.target.value)}
                          placeholder="Paste YouTube or Facebook video URL..."
                          disabled={
                            entry.status === "launching" || entry.status === "done"
                          }
                          className={`flex-1 font-mono text-sm bg-muted/60 border-border focus:border-primary min-w-0 min-h-[44px] h-11 ${
                            entry.status === "done" ? "opacity-60" : ""
                          } ${entry.status === "error" ? "border-red-500/60" : ""}`}
                        />
                        <div className="flex items-center gap-1 shrink-0">
                          {entry.status === "launching" && (
                            <Loader2 className="w-4 h-4 animate-spin text-primary" />
                          )}
                          {entry.status === "done" && (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          )}
                          {entry.previewLoading && entry.status === "idle" && (
                            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                          )}
                          {urls.length > 1 &&
                            entry.status !== "launching" &&
                            entry.status !== "done" && (
                              <button
                                type="button"
                                onClick={() => removeUrl(entry.id)}
                                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-muted-foreground hover:text-destructive rounded-lg hover:bg-destructive/10 transition-colors"
                                aria-label="Remove URL"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            )}
                        </div>
                      </div>

                      {entry.preview && entry.status === "idle" && (
                        <div className="ml-7 flex items-center gap-3 p-2.5 rounded-lg bg-muted/40">
                          {entry.preview.thumbnail && !entry.previewFailed ? (
                            <img
                              src={entry.preview.thumbnail}
                              alt={entry.preview.title || "Preview"}
                              className="w-20 aspect-video object-cover rounded shrink-0 bg-muted"
                              onError={() =>
                                setUrls((prev) =>
                                  prev.map((u) =>
                                    u.id === entry.id
                                      ? { ...u, previewFailed: true }
                                      : u
                                  )
                                )
                              }
                            />
                          ) : (
                            <div className="w-20 aspect-video rounded shrink-0 bg-muted flex items-center justify-center text-muted-foreground">
                              <Video className="w-4 h-4" />
                            </div>
                          )}
                          <p className="text-xs font-medium text-foreground line-clamp-2 leading-snug">
                            {entry.preview.title}
                          </p>
                        </div>
                      )}

                      {!entry.preview &&
                        entry.status === "idle" &&
                        entry.value && (
                          <div className="ml-7">
                            <PlatformCaption url={entry.value} />
                          </div>
                        )}

                      {entry.status === "error" && entry.error && (
                        <p className="text-xs text-red-400 font-mono ml-7 break-words">
                          {entry.error}
                        </p>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>

              <button
                type="button"
                onClick={addUrl}
                disabled={isSubmitting}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors disabled:opacity-40 min-h-[44px] px-1"
              >
                <Plus className="w-4 h-4" />
                Add another URL
              </button>
            </Card>

            {/* Download Quality & Codec */}
            <Card className="p-4 sm:p-6 border-border bg-card space-y-5">
              <div>
                <h2 className="text-base font-display font-semibold text-foreground">
                  Download Quality
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Select stream resolution or skip video download for metadata-only workflows.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {QUALITY_OPTIONS.map((q) => {
                  const selected = quality === q.value;
                  return (
                    <button
                      type="button"
                      key={q.value}
                      onClick={() => setQuality(q.value)}
                      className={`text-left p-3.5 rounded-lg border transition-colors min-h-[58px] ${
                        selected
                          ? "border-primary bg-primary/10"
                          : "border-border bg-muted/25 hover:border-muted-foreground/40 hover:bg-muted/40"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-sm font-medium ${
                            selected ? "text-primary" : "text-foreground"
                          }`}
                        >
                          {q.label}
                        </span>
                        {q.tag && (
                          <span className="text-[11px] font-mono text-primary/90">
                            {q.tag}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {q.desc}
                      </p>
                    </button>
                  );
                })}
              </div>

              {quality !== "none" && (
                <div className="pt-4 border-t border-border space-y-3">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">
                      Video Codec Preference
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Choose container compression or let yt-dlp select the best stream.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    {CODEC_OPTIONS.map((c) => {
                      const selected = codec === c.value;
                      return (
                        <button
                          type="button"
                          key={c.value}
                          onClick={() => setCodec(c.value)}
                          className={`text-left p-3 rounded-lg border transition-colors min-h-[56px] ${
                            selected
                              ? "border-primary bg-primary/10"
                              : "border-border bg-muted/25 hover:border-muted-foreground/40 hover:bg-muted/40"
                          }`}
                        >
                          <span
                            className={`text-sm font-mono font-medium block ${
                              selected ? "text-primary" : "text-foreground"
                            }`}
                          >
                            {c.label}
                          </span>
                          <span className="text-xs text-muted-foreground mt-0.5 block">
                            {c.desc}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </Card>

            {/* Target Platforms & Publish Mode */}
            <Card className="p-4 sm:p-6 border-border bg-card space-y-5">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-display font-semibold text-foreground">
                    Publish Destinations
                  </h2>
                  <span className="text-xs text-muted-foreground">Saved</span>
                </div>

                <div className="space-y-2">
                  {PLATFORM_OPTIONS.map((p) => {
                    const Icon = p.icon;
                    const checked = platforms.includes(p.id);
                    return (
                      <label
                        key={p.id}
                        className={`flex items-center gap-3 p-3.5 rounded-lg border cursor-pointer transition-colors min-h-[56px] ${
                          checked
                            ? "border-primary bg-primary/10"
                            : "border-border bg-muted/20 hover:border-muted-foreground/40"
                        }`}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => togglePlatform(p.id)}
                          className="border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary shrink-0"
                        />
                        <Icon className={`w-4 h-4 shrink-0 ${p.color}`} />
                        <div className="min-w-0 flex-1">
                          <span className="text-sm font-medium text-foreground block">
                            {p.label}
                          </span>
                          <span className="text-xs text-muted-foreground block">
                            {p.desc}
                          </span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="pt-4 border-t border-border space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-foreground">
                    Publish Mode
                  </h3>
                  <span className="text-xs text-muted-foreground">Saved</span>
                </div>

                <RadioGroup
                  value={publishMode}
                  onValueChange={handleModeChange}
                  className="space-y-2"
                >
                  {PUBLISH_MODES.map((mode) => {
                    const Icon = mode.icon;
                    const selected = publishMode === mode.value;
                    return (
                      <label key={mode.value} className="cursor-pointer block">
                        <div
                          className={`flex items-start gap-3 p-3.5 rounded-lg border transition-colors min-h-[56px] ${
                            selected
                              ? "border-primary bg-primary/10"
                              : "border-border bg-muted/20 hover:border-muted-foreground/40"
                          }`}
                        >
                          <RadioGroupItem
                            value={mode.value}
                            id={mode.value}
                            className="mt-0.5 border-border shrink-0"
                          />
                          <Icon
                            className={`w-4 h-4 shrink-0 mt-0.5 ${
                              selected
                                ? "text-primary"
                                : "text-muted-foreground"
                            }`}
                          />
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium text-foreground block">
                              {mode.label}
                            </span>
                            <span className="text-xs text-muted-foreground block mt-0.5">
                              {mode.desc}
                            </span>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </RadioGroup>

                {publishMode === "scheduled" && (
                  <div className="space-y-1.5 pt-1">
                    <Label className="text-xs font-medium text-muted-foreground">
                      Schedule Date & Time
                    </Label>
                    <Input
                      type="datetime-local"
                      value={scheduledAt}
                      onChange={(e) => setScheduledAt(e.target.value)}
                      className="font-mono text-sm bg-muted/60 border-border focus:border-primary min-h-[44px] h-11"
                    />
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* Right Summary & Launch Column */}
          <Card className="p-4 sm:p-5 border-border bg-card space-y-4 lg:sticky lg:top-8">
            <h2 className="text-base font-display font-semibold text-foreground">
              Mission Summary
            </h2>

            <div className="divide-y divide-border text-sm">
              <div className="py-2.5 flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Queued Links</span>
                <span className="font-mono tabular-nums font-medium text-foreground">
                  {validUrls.length}
                </span>
              </div>
              <div className="py-2.5 flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Download</span>
                <span className="font-mono font-medium text-foreground">
                  {selectedQualityObj.label}
                </span>
              </div>
              {quality !== "none" && (
                <div className="py-2.5 flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Codec</span>
                  <span className="font-mono font-medium text-foreground">
                    {selectedCodecObj.label}
                  </span>
                </div>
              )}
              <div className="py-2.5 flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Targets</span>
                <span className="font-medium text-foreground text-right">
                  {platforms.length > 0
                    ? platforms
                        .map((p) =>
                          p === "youtube-shorts"
                            ? "Shorts"
                            : p.charAt(0).toUpperCase() + p.slice(1)
                        )
                        .join(", ")
                    : "None"}
                </span>
              </div>
              <div className="py-2.5 flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Publish Mode</span>
                <span className="font-medium text-foreground">
                  {selectedModeObj.label}
                </span>
              </div>
            </div>

            <Button
              type="submit"
              disabled={!canSubmit}
              className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-medium min-h-[48px] h-12 text-sm"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Launching {completedCount}/{validUrls.length}…
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  {validUrls.length > 1
                    ? `Launch ${validUrls.length} Missions`
                    : "Launch Mission"}
                </>
              )}
            </Button>

            {isSubmitting && (
              <p className="text-xs font-mono tabular-nums text-muted-foreground text-center">
                {completedCount} launched · {errorCount} failed ·{" "}
                {validUrls.length - completedCount - errorCount} queued
              </p>
            )}

            {globalError && (
              <div className="flex items-center gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/25 rounded-lg p-3">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{globalError}</span>
              </div>
            )}
          </Card>
        </form>
      </motion.div>
    </Layout>
  );
}
