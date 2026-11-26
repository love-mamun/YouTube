import { useParams, useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  useGetJob,
  useGetJobStatus,
  useGetJobContent,
  useGetJobThumbnails,
  useUpdateJobContent,
  useProcessJob,
  useApproveJob,
  usePublishJob,
  useSelectThumbnail,
  useListChannels,
  getGetJobQueryKey,
  getGetJobStatusQueryKey,
  getGetJobContentQueryKey,
  getGetJobThumbnailsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { JobPipeline } from "@/components/job-pipeline";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useState, useEffect, useRef } from "react";
import {
  Play,
  CheckCircle2,
  Send,
  Loader2,
  ArrowLeft,
  Youtube,
  Facebook,
  AlertTriangle,
  Copy,
  Check,
  Eye,
  EyeOff,
  ExternalLink,
  Settings as SettingsIcon,
  Square,
  RotateCcw,
  Image as ImageIcon,
} from "lucide-react";
import { parseJobErrorDiagnostic } from "@/lib/ytdlp-errors";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const ACTIVE_STATUSES = [
  "pending",
  "downloading",
  "processing",
  "generating",
  "publishing",
];

function extractYouTubeId(url: string): string | null {
  const match = url.match(/(?:v=|youtu\.be\/|shorts\/)([^&?/]+)/);
  return match?.[1] ?? null;
}

function detectPlatformLabel(url?: string | null): string {
  if (!url) return "Video";
  if (/youtube\.com\/shorts/i.test(url)) return "YouTube Shorts";
  if (/youtube\.com|youtu\.be/i.test(url)) return "YouTube";
  if (/facebook\.com|fb\.watch|fb\.com/i.test(url)) return "Facebook";
  return "Direct URL";
}

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const jobId = parseInt(id || "0", 10);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const { data: job, isLoading } = useGetJob(jobId, {
    query: {
      queryKey: getGetJobQueryKey(jobId),
      refetchInterval: 3000,
      enabled: !!jobId,
    },
  });

  const isActive = ACTIVE_STATUSES.includes(job?.status || "");

  const { data: status } = useGetJobStatus(jobId, {
    query: {
      queryKey: getGetJobStatusQueryKey(jobId),
      refetchInterval: isActive ? 1000 : false,
      enabled: !!jobId && isActive,
    },
  });

  const { data: content } = useGetJobContent(jobId, {
    query: { queryKey: getGetJobContentQueryKey(jobId), enabled: !!jobId },
  });

  const { data: thumbnails } = useGetJobThumbnails(jobId, {
    query: { queryKey: getGetJobThumbnailsQueryKey(jobId), enabled: !!jobId },
  });

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [hashtags, setHashtags] = useState("");

  const { data: channels } = useListChannels();
  const ytChannels = (channels ?? []).filter(
    (c) => c.platform === "youtube" && c.isActive
  );
  const defaultChannel =
    ytChannels.find((c) => c.isDefault) ?? ytChannels[0] ?? null;
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(
    null
  );

  useEffect(() => {
    if (defaultChannel && selectedChannelId === null) {
      setSelectedChannelId(defaultChannel.id);
    }
  }, [defaultChannel?.id]);

  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [failedThumbs, setFailedThumbs] = useState<Record<number, boolean>>({});
  const [failedPreviewImg, setFailedPreviewImg] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<
    "idle" | "saving" | "saved"
  >("idle");
  const isDirty = useRef(false);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (content) {
      isDirty.current = false;
      setTitle(content.title || "");
      setDescription(content.description || "");
      setTags(content.tags || "");
      setHashtags(content.hashtags || "");
    }
  }, [content]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(jobId) });
    queryClient.invalidateQueries({ queryKey: getGetJobStatusQueryKey(jobId) });
    queryClient.invalidateQueries({ queryKey: getGetJobContentQueryKey(jobId) });
    queryClient.invalidateQueries({
      queryKey: getGetJobThumbnailsQueryKey(jobId),
    });
  };

  const processJob = useProcessJob({ mutation: { onSuccess: invalidate } });
  const approveJob = useApproveJob({ mutation: { onSuccess: invalidate } });
  const publishJob = usePublishJob({ mutation: { onSuccess: invalidate } });
  const updateContent = useUpdateJobContent({
    mutation: {
      onSuccess: () => {
        setAutoSaveStatus("saved");
        setTimeout(() => setAutoSaveStatus("idle"), 2000);
        invalidate();
      },
      onError: () => setAutoSaveStatus("idle"),
    },
  });
  const selectThumb = useSelectThumbnail({
    mutation: { onSuccess: invalidate },
  });
  const [cancelling, setCancelling] = useState(false);

  const handleCancelJob = async () => {
    if (!jobId || cancelling) return;
    setCancelling(true);
    try {
      await fetch(`${BASE}/api/jobs/${jobId}/cancel`, {
        method: "POST",
        credentials: "include",
      });
      invalidate();
    } finally {
      setCancelling(false);
    }
  };

  useEffect(() => {
    if (!isDirty.current) return;
    clearTimeout(autoSaveTimer.current);
    setAutoSaveStatus("idle");
    autoSaveTimer.current = setTimeout(() => {
      setAutoSaveStatus("saving");
      updateContent.mutate({
        id: jobId,
        data: { title, description, tags, hashtags },
      });
    }, 1500);
    return () => clearTimeout(autoSaveTimer.current);
  }, [title, description, tags, hashtags]);

  const handleFieldChange =
    (setter: (v: string) => void) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      isDirty.current = true;
      setter(e.target.value);
    };

  const handleCopy = (field: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "s") {
        e.preventDefault();
        if (job?.status === "ready") approveJob.mutate({ id: jobId });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [job?.status, jobId]);

  const selectedThumb = thumbnails?.find((t) => t.isSelected);
  const previewThumbUrl =
    selectedThumb?.imageUrl ??
    (() => {
      if (!job?.youtubeUrl) return null;
      const vid = extractYouTubeId(job.youtubeUrl);
      return vid ? `https://img.youtube.com/vi/${vid}/hqdefault.jpg` : null;
    })();

  useEffect(() => {
    setFailedPreviewImg(false);
  }, [previewThumbUrl]);

  const CopyBtn = ({ field, value }: { field: string; value: string }) => (
    <button
      type="button"
      onClick={() => handleCopy(field, value)}
      className="min-w-[36px] min-h-[36px] sm:min-w-[30px] sm:min-h-[30px] flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      title="Copy to clipboard"
      aria-label={`Copy ${field}`}
    >
      {copiedField === field ? (
        <Check className="w-3.5 h-3.5 text-emerald-400" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
    </button>
  );

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  if (!job) {
    return (
      <Layout>
        <div className="text-center py-16 text-muted-foreground text-sm">
          Mission not found.
        </div>
      </Layout>
    );
  }

  const platforms = (job.platforms || "youtube").split(",");
  const tagCount = tags.split(",").filter((t) => t.trim()).length;
  const hashtagCount = hashtags
    .split(/\s+/)
    .filter((h) => h.startsWith("#")).length;

  return (
    <Layout>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="space-y-5 sm:space-y-6"
      >
        {/* Header & Primary Action Bar */}
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => navigate("/jobs")}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors min-h-[44px] -ml-1 px-1"
          >
            <ArrowLeft className="w-4 h-4" /> All Missions
          </button>

          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-2">
              <h1 className="text-xl sm:text-2xl font-display font-semibold tracking-tight text-foreground line-clamp-2">
                {job.title || job.originalTitle || `Mission #${job.id}`}
              </h1>

              {/* Unboxed metadata strip */}
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-muted-foreground font-mono">
                <StatusBadge status={job.status} />
                <span aria-hidden="true">·</span>
                <span>{detectPlatformLabel(job.youtubeUrl)}</span>
                {job.youtubeUrl && (
                  <>
                    <span aria-hidden="true">·</span>
                    <a
                      href={job.youtubeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline truncate max-w-[240px] sm:max-w-sm"
                    >
                      <span className="truncate">{job.youtubeUrl}</span>
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  </>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 shrink-0">
              {(job.status === "pending" || job.status === "failed") && (
                <Button
                  onClick={() => processJob.mutate({ id: jobId })}
                  disabled={processJob.isPending}
                  className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-medium text-sm min-h-[44px] px-4 flex-1 sm:flex-none"
                >
                  {processJob.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : job.status === "failed" ? (
                    <RotateCcw className="w-4 h-4" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                  {job.status === "failed"
                    ? "Retry Mission"
                    : "Start Processing"}
                </Button>
              )}

              {job.status === "ready" && (
                <Button
                  onClick={() => approveJob.mutate({ id: jobId })}
                  disabled={approveJob.isPending}
                  title="Ctrl+S"
                  className="gap-2 bg-emerald-600 text-white hover:bg-emerald-500 font-medium text-sm min-h-[44px] px-4 flex-1 sm:flex-none"
                >
                  {approveJob.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  Approve Mission
                </Button>
              )}

              {job.status === "approved" && (
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
                  {ytChannels.length > 1 && (
                    <select
                      value={selectedChannelId ?? ""}
                      onChange={(e) =>
                        setSelectedChannelId(
                          e.target.value ? parseInt(e.target.value, 10) : null
                        )
                      }
                      className="min-h-[44px] rounded-md border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      {ytChannels.map((ch) => (
                        <option key={ch.id} value={ch.id}>
                          {ch.channelName}
                          {ch.isDefault ? " (Default)" : ""}
                        </option>
                      ))}
                    </select>
                  )}
                  <Button
                    onClick={() =>
                      publishJob.mutate({
                        id: jobId,
                        data: {
                          platforms: job.platforms || "youtube",
                          channelId: selectedChannelId ?? undefined,
                        },
                      })
                    }
                    disabled={publishJob.isPending}
                    className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-medium text-sm min-h-[44px] px-4 flex-1 sm:flex-none"
                  >
                    {publishJob.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    Publish Now
                  </Button>
                </div>
              )}

              {isActive && job.status !== "pending" && (
                <Button
                  variant="destructive"
                  onClick={handleCancelJob}
                  disabled={cancelling}
                  className="gap-2 font-medium text-sm min-h-[44px] px-4 flex-1 sm:flex-none"
                >
                  {cancelling ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Square className="w-3.5 h-3.5 fill-current" />
                  )}
                  {job.status === "publishing"
                    ? "Stop & Reset"
                    : "Stop Mission"}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Pipeline Status Card */}
        <Card className="p-4 sm:p-6 border-border bg-card space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-display font-semibold text-foreground">
              Pipeline Status
            </h2>
            {isActive && (
              <span className="text-xs font-mono tabular-nums text-primary">
                {status?.progress ?? job.progress ?? 0}% overall
              </span>
            )}
          </div>

          <JobPipeline
            currentStatus={job.status}
            progress={status?.progress ?? job.progress ?? 0}
          />

          {status?.currentStep && job.status !== "failed" && (
            <p className="text-xs text-muted-foreground font-mono pt-1">
              {status.currentStep}
            </p>
          )}

          {job.errorMessage &&
            (() => {
              const diag = parseJobErrorDiagnostic(job.errorMessage);
              return (
                <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                      <div>
                        <h3 className="text-sm font-semibold text-red-200">
                          {diag.title}
                        </h3>
                        <p className="text-xs text-foreground/85 mt-1 leading-relaxed break-words">
                          {diag.summary}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {job.status === "failed" && (
                        <Button
                          size="sm"
                          onClick={() => processJob.mutate({ id: jobId })}
                          disabled={processJob.isPending}
                          className="min-h-[40px] text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 gap-1.5"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Retry Mission
                        </Button>
                      )}
                      {diag.showSettingsLink && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate("/settings")}
                          className="min-h-[40px] text-xs font-medium gap-1.5 border-border bg-card hover:bg-muted"
                        >
                          <SettingsIcon className="w-3.5 h-3.5" /> Open Settings
                        </Button>
                      )}
                    </div>
                  </div>

                  {diag.tips.length > 0 && (
                    <ul className="space-y-1.5 text-xs text-muted-foreground pt-2.5 border-t border-red-500/20 list-disc list-inside">
                      {diag.tips.map((tip, idx) => (
                        <li key={idx}>{tip}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })()}
        </Card>

        {/* Balanced 2-Column Studio Workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
          {/* Left: Metadata & Copy */}
          <Card className="p-4 sm:p-6 border-border bg-card flex flex-col justify-between space-y-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-display font-semibold text-foreground">
                  Metadata & Copy
                </h2>
                {autoSaveStatus !== "idle" && (
                  <div className="flex items-center gap-1.5 text-xs font-mono">
                    {autoSaveStatus === "saving" ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                        <span className="text-muted-foreground">Saving…</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">Saved</span>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-3.5">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium text-muted-foreground">
                      Title
                    </Label>
                    <div className="flex items-center gap-1">
                      <span
                        className={`text-xs font-mono tabular-nums ${
                          title.length > 100
                            ? "text-red-400 font-semibold"
                            : "text-muted-foreground"
                        }`}
                      >
                        {title.length}/100
                      </span>
                      <CopyBtn field="title" value={title} />
                    </div>
                  </div>
                  <Input
                    value={title}
                    onChange={handleFieldChange(setTitle)}
                    className="text-sm bg-muted/50 border-border focus:border-primary min-h-[44px] h-11"
                    placeholder="Video title..."
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium text-muted-foreground">
                      Description
                    </Label>
                    <div className="flex items-center gap-1">
                      <span
                        className={`text-xs font-mono tabular-nums ${
                          description.length > 5000
                            ? "text-red-400 font-semibold"
                            : "text-muted-foreground"
                        }`}
                      >
                        {description.length.toLocaleString()}/5000
                      </span>
                      <CopyBtn field="description" value={description} />
                    </div>
                  </div>
                  <Textarea
                    value={description}
                    onChange={handleFieldChange(setDescription)}
                    rows={6}
                    className="text-sm bg-muted/50 border-border focus:border-primary resize-y"
                    placeholder="Video description..."
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium text-muted-foreground">
                      Tags{" "}
                      <span className="ml-1.5 text-xs font-mono tabular-nums text-muted-foreground/70">
                        · {tagCount}
                      </span>
                    </Label>
                    <CopyBtn field="tags" value={tags} />
                  </div>
                  <Input
                    value={tags}
                    onChange={handleFieldChange(setTags)}
                    className="font-mono text-xs bg-muted/50 border-border focus:border-primary min-h-[44px] h-11"
                    placeholder="tag1, tag2, tag3..."
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium text-muted-foreground">
                      Hashtags{" "}
                      <span className="ml-1.5 text-xs font-mono tabular-nums text-muted-foreground/70">
                        · {hashtagCount}
                      </span>
                    </Label>
                    <CopyBtn field="hashtags" value={hashtags} />
                  </div>
                  <Input
                    value={hashtags}
                    onChange={handleFieldChange(setHashtags)}
                    className="font-mono text-xs bg-muted/50 border-border focus:border-primary min-h-[44px] h-11"
                    placeholder="#shorts #trending..."
                  />
                </div>
              </div>
            </div>

            <p className="text-xs text-muted-foreground/70 pt-2 border-t border-border/70">
              Edits auto-save after 1.5s · Press{" "}
              <span className="font-mono text-foreground/80">Ctrl+S</span> when
              ready to approve.
            </p>
          </Card>

          {/* Right: Preview, Thumbnails & Destinations */}
          <Card className="p-4 sm:p-6 border-border bg-card flex flex-col justify-between space-y-5">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-display font-semibold text-foreground">
                  Thumbnails & Preview
                </h2>
                {previewThumbUrl && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowPreview((p) => !p)}
                    className="gap-1.5 text-xs font-medium min-h-[36px] border-border bg-muted/40 hover:bg-muted"
                  >
                    {showPreview ? (
                      <EyeOff className="w-3.5 h-3.5" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                    {showPreview ? "Hide Preview" : "YouTube Preview"}
                  </Button>
                )}
              </div>

              {showPreview && previewThumbUrl && (
                <div className="rounded-lg bg-muted/40 p-3.5 border border-border/80 space-y-2.5">
                  <p className="text-xs font-medium text-primary">
                    Feed Card Preview
                  </p>
                  <div className="max-w-[280px]">
                    <div className="relative rounded-md overflow-hidden bg-muted">
                      {!failedPreviewImg ? (
                        <img
                          src={previewThumbUrl}
                          alt="YouTube preview"
                          className="w-full aspect-video object-cover"
                          onError={() => setFailedPreviewImg(true)}
                        />
                      ) : (
                        <div className="w-full aspect-video flex flex-col items-center justify-center gap-1.5 text-muted-foreground">
                          <ImageIcon className="w-6 h-6" />
                          <span className="text-xs">Preview unavailable</span>
                        </div>
                      )}
                      <div className="absolute bottom-1.5 right-1.5 bg-black/85 text-white text-[11px] font-mono tabular-nums px-1.5 py-0.5 rounded">
                        0:00
                      </div>
                    </div>
                    <div className="mt-2.5 flex gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-primary/15 border border-primary/30 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground line-clamp-2 leading-snug">
                          {title || "Your video title here"}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          N3XUS Channel · Just now
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {!thumbnails || thumbnails.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-44 text-muted-foreground text-xs border border-dashed border-border rounded-lg gap-2">
                  <ImageIcon className="w-5 h-5 opacity-70" />
                  <span>Thumbnails appear after processing completes</span>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {thumbnails.map((thumb) => {
                    const isBroken = !!failedThumbs[thumb.id];
                    return (
                      <button
                        type="button"
                        key={thumb.id}
                        onClick={() =>
                          selectThumb.mutate({
                            id: jobId,
                            data: { thumbnailId: thumb.id },
                          })
                        }
                        className={`relative rounded-lg overflow-hidden border-2 transition-all active:scale-[0.98] text-left bg-muted/40 ${
                          thumb.isSelected
                            ? "border-primary ring-2 ring-primary/25"
                            : "border-border hover:border-muted-foreground/60"
                        }`}
                      >
                        {!isBroken ? (
                          <img
                            src={thumb.imageUrl}
                            alt={
                              thumb.label ||
                              `Variant ${thumb.variantIndex + 1}`
                            }
                            className="w-full aspect-video object-cover"
                            onError={() =>
                              setFailedThumbs((prev) => ({
                                ...prev,
                                [thumb.id]: true,
                              }))
                            }
                          />
                        ) : (
                          <div className="w-full aspect-video flex flex-col items-center justify-center gap-1 text-muted-foreground bg-muted/60">
                            <ImageIcon className="w-5 h-5" />
                            <span className="text-[11px]">
                              Variant {thumb.variantIndex + 1}
                            </span>
                          </div>
                        )}
                        {thumb.isSelected && (
                          <div className="absolute top-1.5 right-1.5 bg-primary text-primary-foreground text-[10px] font-semibold px-1.5 py-0.5 rounded">
                            Selected
                          </div>
                        )}
                        <div className="px-2.5 py-1.5 text-xs font-medium text-foreground truncate bg-card/90 border-t border-border/60">
                          {thumb.label || `Variant ${thumb.variantIndex + 1}`}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Target Destinations */}
            <div className="pt-4 border-t border-border/70 space-y-2.5">
              <h3 className="text-xs font-medium text-muted-foreground">
                Target Destinations
              </h3>
              <div className="flex flex-wrap gap-3">
                {platforms.map((p) => (
                  <div
                    key={p}
                    className="inline-flex items-center gap-2 text-sm font-medium text-foreground"
                  >
                    {p === "youtube" || p === "youtube-shorts" ? (
                      <Youtube className="w-4 h-4 text-red-500 shrink-0" />
                    ) : (
                      <Facebook className="w-4 h-4 text-blue-500 shrink-0" />
                    )}
                    <span className="capitalize">
                      {p.replace("-", " ")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>
      </motion.div>
    </Layout>
  );
}
