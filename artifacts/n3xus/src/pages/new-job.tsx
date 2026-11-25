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
import { Badge } from "@/components/ui/badge";
import { useState, useCallback, useEffect, useRef } from "react";
import {
  Play, Youtube, Facebook, Clock, Zap, Hand,
  Loader2, Clapperboard, AlertCircle, Plus, X, CheckCircle2, Film,
} from "lucide-react";

const QUALITY_OPTIONS = [
  { value: "none",  label: "No Download",  desc: "Metadata + AI only — fastest, no video file", badge: null },
  { value: "360p",  label: "360p",         desc: "Low quality — small file, fast download",      badge: null },
  { value: "480p",  label: "480p",         desc: "Standard definition — balanced size/quality",  badge: null },
  { value: "720p",  label: "720p HD",       desc: "High definition — recommended",               badge: "HD" },
  { value: "1080p", label: "1080p Full HD", desc: "Full HD — large file, best standard quality", badge: "FHD" },
  { value: "1440p", label: "1440p 2K",      desc: "2K resolution — sharp on large screens",      badge: "2K" },
  { value: "4k",    label: "2160p 4K",      desc: "Ultra HD — highest quality, very large file", badge: "4K" },
];

const CODEC_OPTIONS = [
  { value: "any",  label: "Auto",  desc: "Best available — YouTube picks (usually AV1 for 1080p+)", badge: "Default" },
  { value: "av1",  label: "AV1",   desc: "Smallest file, highest efficiency — modern devices",       badge: null },
  { value: "vp9",  label: "VP9",   desc: "Mid-size, wide compatibility — good all-rounder",          badge: null },
  { value: "h264", label: "H.264", desc: "Largest file — plays everywhere, max compatibility",       badge: "Universal" },
];

const PLATFORM_OPTIONS = [
  { id: "youtube",        label: "YouTube",        desc: "Standard video upload",                      icon: Youtube,      color: "text-red-500"  },
  { id: "youtube-shorts", label: "YouTube Shorts", desc: "Vertical short-form (≤60s) — adds #Shorts", icon: Clapperboard, color: "text-red-400", badge: "Shorts" },
  { id: "facebook",       label: "Facebook",       desc: "Facebook video post",                        icon: Facebook,     color: "text-blue-500" },
];

const PUBLISH_MODES = [
  { value: "auto",      label: "Auto Publish",   desc: "Publish immediately after processing completes", icon: Zap   },
  { value: "scheduled", label: "Scheduled",      desc: "Publish at a specific date and time",            icon: Clock },
  { value: "manual",    label: "Manual Approval",desc: "Review content before publishing",               icon: Hand  },
];

function detectPlatform(url: string): "youtube" | "facebook" | "other" | null {
  if (!url.trim()) return null;
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  if (/facebook\.com|fb\.watch|fb\.com/i.test(url)) return "facebook";
  return "other";
}

function PlatformBadge({ url }: { url: string }) {
  const p = detectPlatform(url);
  if (!p) return null;
  if (p === "youtube")
    return (
      <Badge variant="secondary" className="text-[10px] gap-1 bg-red-500/10 text-red-400 border-red-500/20">
        <Youtube className="w-3 h-3" /> YouTube
      </Badge>
    );
  if (p === "facebook")
    return (
      <Badge variant="secondary" className="text-[10px] gap-1 bg-blue-500/10 text-blue-400 border-blue-500/20">
        <Facebook className="w-3 h-3" /> Facebook
      </Badge>
    );
  return (
    <Badge variant="secondary" className="text-[10px] gap-1">
      <AlertCircle className="w-3 h-3" /> Other
    </Badge>
  );
}

interface UrlPreview { thumbnail: string; title: string }

type UrlStatus = "idle" | "launching" | "done" | "error";
interface UrlEntry {
  id: number;
  value: string;
  status: UrlStatus;
  error?: string;
  preview?: UrlPreview;
  previewLoading?: boolean;
}

let nextId = 1;

function extractYouTubeId(url: string): string | null {
  const m = url.match(/(?:v=|youtu\.be\/|shorts\/)([^&?/]+)/);
  return m?.[1] ?? null;
}

const LS_PLATFORMS = "n3xus_platforms";
const LS_MODE     = "n3xus_publishMode";

function loadSavedPlatforms(): string[] {
  try {
    const s = localStorage.getItem(LS_PLATFORMS);
    if (s) { const p = JSON.parse(s); if (Array.isArray(p) && p.length) return p; }
  } catch { /* noop */ }
  return ["youtube"];
}

function loadSavedMode(): string {
  return localStorage.getItem(LS_MODE) || "manual";
}

export default function NewJob() {
  const [, navigate] = useLocation();
  const [urls, setUrls] = useState<UrlEntry[]>([{ id: nextId++, value: "", status: "idle" }]);
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

  const addUrl = () => setUrls((prev) => [...prev, { id: nextId++, value: "", status: "idle" }]);
  const removeUrl = (id: number) => {
    clearTimeout(previewTimers.current[id]);
    setUrls((prev) => prev.filter((u) => u.id !== id));
  };

  const fetchPreview = (id: number, value: string) => {
    clearTimeout(previewTimers.current[id]);
    if (!value.trim() || !/youtube\.com|youtu\.be/i.test(value)) {
      setUrls((prev) => prev.map((u) => u.id === id ? { ...u, preview: undefined, previewLoading: false } : u));
      return;
    }
    setUrls((prev) => prev.map((u) => u.id === id ? { ...u, previewLoading: true } : u));
    previewTimers.current[id] = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://www.youtube.com/oembed?url=${encodeURIComponent(value)}&format=json`
        );
        if (res.ok) {
          const data = (await res.json()) as { title?: string; thumbnail_url?: string };
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
                        : (data.thumbnail_url ?? ""),
                      title: data.title ?? "",
                    },
                  }
                : u
            )
          );
        } else {
          setUrls((prev) => prev.map((u) => u.id === id ? { ...u, previewLoading: false, preview: undefined } : u));
        }
      } catch {
        setUrls((prev) => prev.map((u) => u.id === id ? { ...u, previewLoading: false, preview: undefined } : u));
      }
    }, 600);
  };

  const setUrlValue = (id: number, value: string) => {
    setUrls((prev) =>
      prev.map((u) => u.id === id ? { ...u, value, status: "idle", error: undefined } : u)
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
        setUrls((prev) => prev.map((u) => u.id === entry.id ? { ...u, status: "launching" } : u));
        try {
          const job = await createJob.mutateAsync({
            data: {
              youtubeUrl: entry.value.trim(),
              publishMode,
              platforms: platforms.join(","),
              scheduledAt: scheduledAt || null,
              ...(quality !== "none" ? { quality } : {}),
              ...(quality !== "none" && codec !== "any" ? { codec } : {}),
              missionType: "normal",
            },
          });
          setUrls((prev) => prev.map((u) => u.id === entry.id ? { ...u, status: "done" } : u));
          lastJobId = job.id;
          successCount++;
        } catch (err) {
          const msg = (err as { message?: string })?.message ?? "Failed to launch";
          setUrls((prev) =>
            prev.map((u) => u.id === entry.id ? { ...u, status: "error", error: msg } : u)
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
    [canSubmit, validUrls, publishMode, platforms, scheduledAt, createJob, queryClient, navigate]
  );

  const completedCount = urls.filter((u) => u.status === "done").length;
  const errorCount = urls.filter((u) => u.status === "error").length;

  return (
    <Layout>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="max-w-2xl space-y-5 sm:space-y-6"
      >
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground mb-1 tracking-widest uppercase">
            <div className="w-1.5 h-1.5 rounded-full bg-primary" />
            Mission Setup
          </div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground">New Mission</h1>
          <p className="text-muted-foreground text-sm mt-1">Configure your autopilot parameters before launch.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">

          {/* URL List */}
          <Card className="p-4 sm:p-6 border-border bg-card/80 backdrop-blur-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Source Video URLs</h2>
              {urls.length > 1 && (
                <span className="text-xs font-mono text-muted-foreground">{urls.length} links</span>
              )}
            </div>

            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {urls.map((entry, idx) => (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.18 }}
                    className="overflow-hidden"
                  >
                    {/* URL row */}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-muted-foreground w-4 text-right shrink-0">
                        {idx + 1}
                      </span>
                      <Input
                        value={entry.value}
                        onChange={(e) => setUrlValue(entry.id, e.target.value)}
                        placeholder="Paste YouTube or Facebook video URL..."
                        disabled={entry.status === "launching" || entry.status === "done"}
                        className={`flex-1 font-mono text-sm bg-muted border-border focus:border-primary min-w-0 h-11 sm:h-9 ${
                          entry.status === "done" ? "opacity-60" : ""
                        } ${entry.status === "error" ? "border-destructive/60" : ""}`}
                      />
                      <div className="flex items-center gap-1 shrink-0">
                        {entry.status === "launching" && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
                        {entry.status === "done" && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                        {entry.previewLoading && entry.status === "idle" && (
                          <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                        )}
                        {urls.length > 1 && entry.status !== "launching" && entry.status !== "done" && (
                          <button
                            type="button"
                            onClick={() => removeUrl(entry.id)}
                            className="text-muted-foreground hover:text-destructive transition-colors p-2.5 -mr-1 rounded-md hover:bg-destructive/10"
                            aria-label="Remove URL"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* URL preview card */}
                    {entry.preview && entry.status === "idle" && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        className="ml-6 mt-1.5 flex items-center gap-2.5 p-2 rounded-md bg-muted/50 border border-border overflow-hidden"
                      >
                        <img
                          src={entry.preview.thumbnail}
                          alt="thumb"
                          className="w-16 aspect-video object-cover rounded shrink-0"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                        <p className="text-[11px] font-medium text-foreground line-clamp-2 leading-snug">
                          {entry.preview.title}
                        </p>
                      </motion.div>
                    )}

                    {/* Platform badge */}
                    {!entry.preview && entry.status === "idle" && entry.value && (
                      <div className="ml-6 mt-1">
                        <PlatformBadge url={entry.value} />
                      </div>
                    )}

                    {entry.status === "error" && entry.error && (
                      <p className="text-xs text-destructive font-mono mt-1 ml-6 break-words">{entry.error}</p>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            <button
              type="button"
              onClick={addUrl}
              disabled={isSubmitting}
              className="flex items-center gap-2 text-xs font-mono text-primary hover:text-primary/80 transition-colors disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5" />
              Add another URL
            </button>

            <p className="text-xs text-muted-foreground">
              Supports YouTube videos, YouTube Shorts, and Facebook videos.{" "}
              {urls.length > 1 && <span className="text-primary">Each URL creates a separate mission.</span>}
            </p>
          </Card>

          {/* Download Quality */}
          <Card className="p-4 sm:p-6 border-border bg-card/80 backdrop-blur-sm space-y-3 sm:space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Download Quality</h2>
              <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground/60">
                <Film className="w-3 h-3" />
                video file
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {QUALITY_OPTIONS.map((q) => (
                <label
                  key={q.value}
                  className={`flex items-center gap-3 p-3 rounded-md border cursor-pointer transition-all active:scale-[0.99] ${
                    quality === q.value
                      ? "border-primary/50 bg-primary/5"
                      : "border-border hover:border-muted-foreground/30"
                  }`}
                >
                  <input
                    type="radio"
                    name="quality"
                    value={q.value}
                    checked={quality === q.value}
                    onChange={() => setQuality(q.value)}
                    className="accent-cyan-400 shrink-0"
                  />
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-foreground">{q.label}</span>
                        {q.badge && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-primary/10 text-primary border-primary/20">
                            {q.badge}
                          </Badge>
                        )}
                        {q.value === "none" && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-green-500/10 text-green-400 border-green-500/20">
                            Fast
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{q.desc}</p>
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </Card>

          {/* Codec Selector — only shown when a download quality is selected */}
          {quality !== "none" && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
            >
              <Card className="p-4 sm:p-6 border-border bg-card/80 backdrop-blur-sm space-y-3 sm:space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Video Codec</h2>
                  <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground/60">
                    <Film className="w-3 h-3" />
                    compression
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {CODEC_OPTIONS.map((c) => (
                    <label
                      key={c.value}
                      className={`flex items-center gap-3 p-3 rounded-md border cursor-pointer transition-all active:scale-[0.99] ${
                        codec === c.value
                          ? "border-primary/50 bg-primary/5"
                          : "border-border hover:border-muted-foreground/30"
                      }`}
                    >
                      <input
                        type="radio"
                        name="codec"
                        value={c.value}
                        checked={codec === c.value}
                        onChange={() => setCodec(c.value)}
                        className="accent-cyan-400 shrink-0"
                      />
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-foreground font-mono">{c.label}</span>
                            {c.badge && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-primary/10 text-primary border-primary/20">
                                {c.badge}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">{c.desc}</p>
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </Card>
            </motion.div>
          )}

          {/* Target Platforms */}
          <Card className="p-4 sm:p-6 border-border bg-card/80 backdrop-blur-sm space-y-3 sm:space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Publish To</h2>
              <span className="text-[10px] font-mono text-muted-foreground/60">remembered</span>
            </div>
            <div className="space-y-2.5">
              {PLATFORM_OPTIONS.map((p) => {
                const Icon = p.icon;
                const checked = platforms.includes(p.id);
                return (
                  <label
                    key={p.id}
                    className={`flex items-center gap-3 p-3 rounded-md border cursor-pointer transition-all active:scale-[0.99] ${
                      checked ? "border-primary/50 bg-primary/5" : "border-border hover:border-muted-foreground/30"
                    }`}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => togglePlatform(p.id)}
                      className="border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary shrink-0"
                    />
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Icon className={`w-4 h-4 shrink-0 ${p.color}`} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-foreground">{p.label}</span>
                          {"badge" in p && p.badge && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-red-500/10 text-red-400 border-red-500/20">
                              {p.badge}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{p.desc}</p>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </Card>

          {/* Publish Mode */}
          <Card className="p-4 sm:p-6 border-border bg-card/80 backdrop-blur-sm space-y-3 sm:space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Publish Mode</h2>
              <span className="text-[10px] font-mono text-muted-foreground/60">remembered</span>
            </div>
            <RadioGroup value={publishMode} onValueChange={handleModeChange} className="space-y-2.5">
              {PUBLISH_MODES.map((mode) => {
                const Icon = mode.icon;
                return (
                  <label key={mode.value} className="cursor-pointer">
                    <div
                      className={`flex items-start gap-3 p-3 sm:p-4 rounded-md border transition-all active:scale-[0.99] ${
                        publishMode === mode.value ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/30"
                      }`}
                    >
                      <RadioGroupItem value={mode.value} id={mode.value} className="mt-0.5 border-border shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Icon
                            className={`w-4 h-4 shrink-0 ${
                              publishMode === mode.value ? "text-primary" : "text-muted-foreground"
                            }`}
                          />
                          <span className="text-sm font-medium text-foreground">{mode.label}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{mode.desc}</p>
                      </div>
                    </div>
                  </label>
                );
              })}
            </RadioGroup>

            {publishMode === "scheduled" && (
              <div className="space-y-2 pt-1">
                <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                  Schedule Date & Time
                </Label>
                <Input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="font-mono text-sm bg-muted border-border focus:border-primary"
                />
              </div>
            )}
          </Card>

          {/* Launch Button */}
          <Button
            type="submit"
            disabled={!canSubmit}
            className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/80 font-mono font-semibold h-12 text-base"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Launching {completedCount}/{validUrls.length}…
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                {validUrls.length > 1 ? `Launch ${validUrls.length} Missions` : "Launch Mission"}
              </>
            )}
          </Button>

          {isSubmitting && (
            <div className="text-xs font-mono text-muted-foreground text-center">
              {completedCount} launched · {errorCount} failed · {validUrls.length - completedCount - errorCount} queued
            </div>
          )}

          {globalError && (
            <div className="flex items-center gap-2 text-xs text-destructive font-mono bg-destructive/10 border border-destructive/20 rounded-md p-3">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {globalError}
            </div>
          )}
        </form>
      </motion.div>
    </Layout>
  );
}
