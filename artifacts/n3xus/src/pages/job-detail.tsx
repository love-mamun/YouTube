import { useParams, useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  useGetJob, useGetJobStatus, useGetJobContent, useGetJobThumbnails,
  useUpdateJobContent, useProcessJob, useApproveJob, usePublishJob,
  useSelectThumbnail, useListChannels,
  getGetJobQueryKey, getGetJobStatusQueryKey, getGetJobContentQueryKey, getGetJobThumbnailsQueryKey,
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
  Play, CheckCircle2, Send, Loader2, ArrowLeft, Youtube,
  Facebook, AlertTriangle, Copy, Check, Eye, EyeOff,
  ThumbsUp, Upload, ExternalLink,
} from "lucide-react";

const ACTIVE_STATUSES = ["pending", "downloading", "processing", "generating", "publishing"];

function extractYouTubeId(url: string): string | null {
  const match = url.match(/(?:v=|youtu\.be\/|shorts\/)([^&?/]+)/);
  return match?.[1] ?? null;
}

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const jobId = parseInt(id || "0", 10);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const { data: job, isLoading } = useGetJob(jobId, {
    query: { queryKey: getGetJobQueryKey(jobId), refetchInterval: 3000, enabled: !!jobId },
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
  const ytChannels = (channels ?? []).filter((c) => c.platform === "youtube" && c.isActive);
  const defaultChannel = ytChannels.find((c) => c.isDefault) ?? ytChannels[0] ?? null;
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(null);
  // Sync to default once channels load
  useEffect(() => {
    if (defaultChannel && selectedChannelId === null) {
      setSelectedChannelId(defaultChannel.id);
    }
  }, [defaultChannel?.id]);

  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const isDirty = useRef(false);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout>>();

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
    queryClient.invalidateQueries({ queryKey: getGetJobThumbnailsQueryKey(jobId) });
  };

  const processJob    = useProcessJob({ mutation: { onSuccess: invalidate } });
  const approveJob    = useApproveJob({ mutation: { onSuccess: invalidate } });
  const publishJob    = usePublishJob({ mutation: { onSuccess: invalidate } });
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
  const selectThumb   = useSelectThumbnail({ mutation: { onSuccess: invalidate } });

  useEffect(() => {
    if (!isDirty.current) return;
    clearTimeout(autoSaveTimer.current);
    setAutoSaveStatus("idle");
    autoSaveTimer.current = setTimeout(() => {
      setAutoSaveStatus("saving");
      updateContent.mutate({ id: jobId, data: { title, description, tags, hashtags } });
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
  const previewThumbUrl = selectedThumb?.imageUrl ?? (() => {
    if (!job?.youtubeUrl) return null;
    const vid = extractYouTubeId(job.youtubeUrl);
    return vid ? `https://img.youtube.com/vi/${vid}/hqdefault.jpg` : null;
  })();

  const CopyBtn = ({ field, value }: { field: string; value: string }) => (
    <button
      type="button"
      onClick={() => handleCopy(field, value)}
      className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
      title="Copy to clipboard"
    >
      {copiedField === field ? (
        <Check className="w-3 h-3 text-green-400" />
      ) : (
        <Copy className="w-3 h-3" />
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
        <div className="text-center py-16 text-muted-foreground">Mission not found.</div>
      </Layout>
    );
  }

  const platforms = (job.platforms || "youtube").split(",");

  return (
    <Layout>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="space-y-4 sm:space-y-6"
      >
        {/* Header */}
        <div className="flex flex-col gap-3">
          <button
            onClick={() => navigate("/jobs")}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground font-mono transition-colors w-fit"
          >
            <ArrowLeft className="w-3 h-3" /> All Missions
          </button>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-display font-bold text-foreground line-clamp-2">
                {job.title || job.originalTitle || "Mission Details"}
              </h1>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <StatusBadge status={job.status} />
                {job.youtubeUrl && (
                  <a
                    href={job.youtubeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-muted-foreground hover:text-primary font-mono truncate max-w-[180px] sm:max-w-xs"
                  >
                    {job.youtubeUrl}
                  </a>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 shrink-0">
              {(job.status === "pending" || job.status === "failed") && (
                <Button
                  onClick={() => processJob.mutate({ id: jobId })}
                  disabled={processJob.isPending}
                  className={`gap-2 font-mono text-xs flex-1 sm:flex-none ${
                    job.status === "failed"
                      ? "bg-amber-600 text-white hover:bg-amber-700"
                      : "bg-primary text-primary-foreground hover:bg-primary/80"
                  }`}
                >
                  {processJob.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  {job.status === "failed" ? "Retry Mission" : "Start Processing"}
                </Button>
              )}
              {job.status === "ready" && (
                <Button
                  onClick={() => approveJob.mutate({ id: jobId })}
                  disabled={approveJob.isPending}
                  title="Ctrl+S"
                  className="gap-2 bg-green-600 text-white hover:bg-green-700 font-mono text-xs flex-1 sm:flex-none"
                >
                  {approveJob.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Approve
                </Button>
              )}
              {job.status === "approved" && (
                <div className="flex items-center gap-2 flex-1 sm:flex-none">
                  {ytChannels.length > 1 && (
                    <select
                      value={selectedChannelId ?? ""}
                      onChange={(e) => setSelectedChannelId(e.target.value ? parseInt(e.target.value, 10) : null)}
                      className="h-8 rounded-md border border-border bg-background px-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      {ytChannels.map((ch) => (
                        <option key={ch.id} value={ch.id}>
                          {ch.channelName}{ch.isDefault ? " ★" : ""}
                        </option>
                      ))}
                    </select>
                  )}
                  <Button
                    onClick={() => publishJob.mutate({
                      id: jobId,
                      data: { platforms: job.platforms || "youtube", channelId: selectedChannelId ?? undefined },
                    })}
                    disabled={publishJob.isPending}
                    className="gap-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 font-mono text-xs flex-1 sm:flex-none"
                  >
                    {publishJob.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Publish Now
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Pipeline */}
        <Card className="p-4 sm:p-6 border-border bg-card/80 backdrop-blur-sm">
          <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-4">Pipeline Status</h2>
          <JobPipeline currentStatus={job.status} progress={status?.progress ?? job.progress ?? 0} />
          {status?.currentStep && (
            <p className="text-xs text-muted-foreground font-mono mt-3">
              <span className="text-primary">&#x25B6;</span> {status.currentStep}
            </p>
          )}
          {job.errorMessage && (
            <div className="mt-3 flex items-start gap-2 text-xs text-destructive font-mono bg-destructive/10 p-3 rounded">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span className="break-words">{job.errorMessage}</span>
            </div>
          )}
        </Card>

        {/* Content + Thumbnails */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">

          {/* Content */}
          <Card className="p-4 sm:p-6 border-border bg-card/80 backdrop-blur-sm space-y-4">

            {/* Card header */}
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Content</h2>
            </div>

            {/* Auto-save status */}
            {autoSaveStatus !== "idle" && (
              <div className="flex items-center gap-1.5 text-[10px] font-mono">
                {autoSaveStatus === "saving" ? (
                  <><Loader2 className="w-3 h-3 animate-spin text-muted-foreground" /><span className="text-muted-foreground">Auto-saving…</span></>
                ) : (
                  <><Check className="w-3 h-3 text-green-400" /><span className="text-green-400">Saved</span></>
                )}
              </div>
            )}

            <div className="space-y-3">
              {/* Title */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-mono text-muted-foreground">Title</Label>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[10px] font-mono ${title.length > 100 ? "text-destructive font-bold" : "text-muted-foreground"}`}>
                      {title.length}/100
                    </span>
                    <CopyBtn field="title" value={title} />
                  </div>
                </div>
                <Input
                  value={title}
                  onChange={handleFieldChange(setTitle)}
                  className="font-mono text-sm bg-muted border-border focus:border-primary"
                  placeholder="Video title..."
                />
              </div>

              {/* Description */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-mono text-muted-foreground">Description</Label>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[10px] font-mono ${description.length > 5000 ? "text-destructive font-bold" : "text-muted-foreground"}`}>
                      {description.length.toLocaleString()}/5000
                    </span>
                    <CopyBtn field="description" value={description} />
                  </div>
                </div>
                <Textarea
                  value={description}
                  onChange={handleFieldChange(setDescription)}
                  rows={5}
                  className="font-mono text-sm bg-muted border-border focus:border-primary resize-none"
                  placeholder="Video description..."
                />
              </div>

              {/* Tags */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-mono text-muted-foreground">
                    Tags
                    <span className="ml-2 text-[10px] text-muted-foreground/60 font-normal">
                      {tags.split(",").filter((t) => t.trim()).length} tags
                    </span>
                  </Label>
                  <CopyBtn field="tags" value={tags} />
                </div>
                <Input
                  value={tags}
                  onChange={handleFieldChange(setTags)}
                  className="font-mono text-sm bg-muted border-border focus:border-primary"
                  placeholder="tag1, tag2, tag3..."
                />
              </div>

              {/* Hashtags */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-mono text-muted-foreground">
                    Hashtags
                    <span className="ml-2 text-[10px] text-muted-foreground/60 font-normal">
                      {hashtags.split(/\s+/).filter((h) => h.startsWith("#")).length} tags
                    </span>
                  </Label>
                  <CopyBtn field="hashtags" value={hashtags} />
                </div>
                <Input
                  value={hashtags}
                  onChange={handleFieldChange(setHashtags)}
                  className="font-mono text-sm bg-muted border-border focus:border-primary"
                  placeholder="#trending #viral..."
                />
              </div>

              <p className="text-[10px] font-mono text-muted-foreground/40">
                ⌨ Ctrl+S approve · edits auto-save after 1.5s
              </p>
            </div>
          </Card>

          {/* Thumbnails */}
          <Card className="p-4 sm:p-6 border-border bg-card/80 backdrop-blur-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Thumbnail Variants</h2>
              {previewThumbUrl && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowPreview(!showPreview)}
                  className="gap-1 text-[10px] font-mono text-muted-foreground hover:text-primary h-6 px-2"
                >
                  {showPreview ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  Preview
                </Button>
              )}
            </div>

            {/* YouTube Publish Preview */}
            {showPreview && previewThumbUrl && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="overflow-hidden"
              >
                <div className="bg-muted/40 rounded-lg p-3 border border-border/50">
                  <p className="text-[10px] font-mono text-primary mb-2 uppercase tracking-widest">YouTube Preview</p>
                  <div className="max-w-[240px] mx-auto">
                    <div className="relative rounded overflow-hidden">
                      <img
                        src={previewThumbUrl}
                        alt="Preview"
                        className="w-full aspect-video object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src =
                            "https://placehold.co/320x180/1a1a2e/00d4ff?text=Preview";
                        }}
                      />
                      <div className="absolute bottom-1 right-1 bg-black/90 text-white text-[9px] font-mono px-1 rounded">
                        0:00
                      </div>
                    </div>
                    <div className="mt-1.5 flex gap-2">
                      <div className="w-7 h-7 rounded-full bg-primary/20 border border-primary/30 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground line-clamp-2 leading-tight">
                          {title || "Your video title here"}
                        </p>
                        <p className="text-[10px] text-muted-foreground font-mono mt-0.5">N3XUS Channel · Just now</p>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {!thumbnails || thumbnails.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-xs font-mono border border-dashed border-border rounded">
                Thumbnails generated after processing
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {thumbnails.map((thumb) => (
                  <button
                    key={thumb.id}
                    onClick={() => selectThumb.mutate({ id: jobId, data: { thumbnailId: thumb.id } })}
                    className={`relative rounded overflow-hidden border-2 transition-all active:scale-95 ${
                      thumb.isSelected
                        ? "border-primary shadow-[0_0_12px_hsl(var(--primary)/0.4)]"
                        : "border-border hover:border-muted-foreground/50"
                    }`}
                  >
                    <img
                      src={thumb.imageUrl}
                      alt={thumb.label || `Variant ${thumb.variantIndex + 1}`}
                      className="w-full aspect-video object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src =
                          "https://placehold.co/320x180/1a1a2e/00d4ff?text=Thumbnail";
                      }}
                    />
                    {thumb.isSelected && (
                      <div className="absolute top-1 right-1 bg-primary text-primary-foreground text-[9px] font-mono px-1 rounded">
                        ✓
                      </div>
                    )}
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] font-mono px-2 py-1 truncate">
                      {thumb.label || `Variant ${thumb.variantIndex + 1}`}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Target Platforms */}
        <Card className="p-4 sm:p-6 border-border bg-card/80 backdrop-blur-sm">
          <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-4">Target Platforms</h2>
          <div className="flex flex-wrap gap-2 sm:gap-3">
            {platforms.map((p) => (
              <div key={p} className="flex items-center gap-2 bg-muted px-3 sm:px-4 py-2 rounded border border-border">
                {p === "youtube" || p === "youtube-shorts" ? (
                  <Youtube className="w-4 h-4 text-red-500 shrink-0" />
                ) : (
                  <Facebook className="w-4 h-4 text-blue-500 shrink-0" />
                )}
                <span className="text-sm font-medium capitalize">{p}</span>
              </div>
            ))}
          </div>
        </Card>
      </motion.div>
    </Layout>
  );
}
