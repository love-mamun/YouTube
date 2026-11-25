import { Router, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db, videoJobsTable, publishLogsTable } from "@workspace/db";
import {
  ListJobsQueryParams,
  CreateJobBody,
  GetJobParams,
  DeleteJobParams,
  GetJobStatusParams,
  GetJobStatusResponse,
  ProcessJobParams,
  ApproveJobParams,
} from "@workspace/api-zod";
import { generateAiContent } from "../lib/ai-content";
import { startVideoProcessing } from "../lib/video-processor";
import { publishToYouTube, updatePublishLog } from "../lib/youtube-publisher";
import { publishToFacebook } from "../lib/facebook-publisher";
import { downloadVideoForJob } from "../lib/video-processor";
import { existsSync } from "fs";

const router: IRouter = Router();

router.get("/jobs", async (req, res): Promise<void> => {
  const params = ListJobsQueryParams.safeParse(req.query);
  const limit = params.success ? (params.data.limit ?? 50) : 50;
  const offset = params.success ? (params.data.offset ?? 0) : 0;
  const status = params.success ? params.data.status : undefined;

  const conditions = status ? [eq(videoJobsTable.status, status)] : [];

  const jobs = await db
    .select()
    .from(videoJobsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(videoJobsTable.createdAt))
    .limit(Number(limit))
    .offset(Number(offset));

  res.json(jobs);
});

router.post("/jobs", async (req, res): Promise<void> => {
  const parsed = CreateJobBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { youtubeUrl, publishMode, platforms, scheduledAt, quality, missionType } = parsed.data;

  const [job] = await db
    .insert(videoJobsTable)
    .values({
      youtubeUrl,
      publishMode: publishMode || "manual",
      platforms: platforms || "youtube",
      scheduledAt: scheduledAt ?? null,
      quality: quality ?? null,
      missionType: missionType ?? "normal",
      status: "pending",
      progress: 0,
    })
    .returning();

  res.status(201).json(job);

  // Auto-kick off processing immediately in the background
  startVideoProcessing(job.id, job.youtubeUrl || "").catch((err) => {
    req.log.error({ err, jobId: job.id }, "Auto-start processing failed");
  });
});

router.get("/jobs/:id", async (req, res): Promise<void> => {
  const params = GetJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid job ID" });
    return;
  }

  const [job] = await db
    .select()
    .from(videoJobsTable)
    .where(eq(videoJobsTable.id, params.data.id));

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.json(job);
});

router.delete("/jobs/:id", async (req, res): Promise<void> => {
  const params = DeleteJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid job ID" });
    return;
  }

  await db.delete(videoJobsTable).where(eq(videoJobsTable.id, params.data.id));
  res.sendStatus(204);
});

router.get("/jobs/:id/status", async (req, res): Promise<void> => {
  const params = GetJobStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid job ID" });
    return;
  }

  const [job] = await db
    .select()
    .from(videoJobsTable)
    .where(eq(videoJobsTable.id, params.data.id));

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const stepLabels: Record<string, string> = {
    pending: "Waiting in queue",
    downloading: job.progress != null && job.progress < 43
      ? `Downloading video… ${job.progress ?? 0}%`
      : "Download complete",
    processing: job.progress != null
      ? `FFmpeg encoding… ${Math.max(0, Math.round(((job.progress - 45) / 0.27)))}%`
      : "FFmpeg encoding…",
    generating: "Preparing content…",
    ready: "Content ready for review",
    approved: "Approved — ready to publish",
    publishing: "Uploading to platforms…",
    published: "Mission complete",
    failed: "Mission failed",
  };

  res.json(
    GetJobStatusResponse.parse({
      id: job.id,
      status: job.status,
      progress: job.progress ?? 0,
      currentStep: stepLabels[job.status] ?? job.status,
      errorMessage: job.errorMessage,
    })
  );
});

router.post("/jobs/:id/process", async (req, res): Promise<void> => {
  const params = ProcessJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid job ID" });
    return;
  }

  const [job] = await db
    .select()
    .from(videoJobsTable)
    .where(eq(videoJobsTable.id, params.data.id));

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (!["pending", "failed"].includes(job.status)) {
    res.status(400).json({ error: `Job is already in status: ${job.status}` });
    return;
  }

  startVideoProcessing(job.id, job.youtubeUrl || "").catch((err) => {
    req.log.error({ err, jobId: job.id }, "Background processing failed");
  });

  const [updated] = await db
    .update(videoJobsTable)
    .set({ status: "downloading", progress: 5, errorMessage: null })
    .where(eq(videoJobsTable.id, job.id))
    .returning();

  res.json(updated);
});

router.post("/jobs/:id/approve", async (req, res): Promise<void> => {
  const params = ApproveJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid job ID" });
    return;
  }

  const [job] = await db
    .select()
    .from(videoJobsTable)
    .where(eq(videoJobsTable.id, params.data.id));

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const [updated] = await db
    .update(videoJobsTable)
    .set({ status: "approved" })
    .where(eq(videoJobsTable.id, job.id))
    .returning();

  res.json(updated);
});

router.post("/jobs/:id/publish", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid job ID" });
    return;
  }

  const [job] = await db
    .select()
    .from(videoJobsTable)
    .where(eq(videoJobsTable.id, id));

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (["publishing", "published"].includes(job.status)) {
    res.status(409).json({ error: `Job is already ${job.status}` });
    return;
  }

  const platforms = (req.body.platforms || job.platforms || "youtube")
    .split(",")
    .map((p: string) => p.trim())
    .filter(Boolean);

  for (const platform of platforms) {
    await db
      .insert(publishLogsTable)
      .values({ jobId: job.id, platform, status: "pending" })
      .onConflictDoUpdate({
        target: [publishLogsTable.jobId, publishLogsTable.platform],
        set: { status: "pending", platformUrl: null, errorMessage: null },
      })
      .catch(() =>
        db.insert(publishLogsTable).values({ jobId: job.id, platform, status: "pending" })
      );
  }

  const [updated] = await db
    .update(videoJobsTable)
    .set({ status: "publishing", progress: 80 })
    .where(eq(videoJobsTable.id, id))
    .returning();

  (async () => {
    const succeeded = new Set<string>();
    let failedPlatform: string | null = null;
    let failMsg = "";

    for (const platform of platforms) {
      try {
        if (platform === "youtube" || platform === "youtube-shorts") {
          const isShorts = platform === "youtube-shorts";

          const { apiTokensTable: tokTable } = await import("@workspace/db");
          const [ytToken] = await db
            .select()
            .from(tokTable)
            .where(and(eq(tokTable.platform, "youtube"), eq(tokTable.isActive, true)))
            .limit(1);

          if (ytToken) {
            const rawCid = req.body?.channelId;
            const parsedCid = rawCid != null ? parseInt(String(rawCid), 10) : null;
            const channelId = parsedCid !== null && !isNaN(parsedCid) && parsedCid > 0 ? parsedCid : null;
            req.log.info({ jobId: id, isShorts, channelId }, "Publishing to YouTube via OAuth");
            const result = await publishToYouTube(id, { isShorts, channelId });
            await updatePublishLog(id, platform, "success", result.url);
          } else {
            req.log.info({ jobId: id, isShorts }, "No YouTube token — using simulator");
            await new Promise((r) => setTimeout(r, 3000));
            const simUrl = isShorts
              ? `https://youtube.com/shorts/sim-${id}-${Date.now()}`
              : `https://youtube.com/watch?v=sim-${id}-${Date.now()}`;
            await updatePublishLog(id, platform, "success", simUrl);
          }
        } else if (platform === "facebook") {
          const { apiTokensTable: tokTable } = await import("@workspace/db");
          const [fbToken] = await db
            .select()
            .from(tokTable)
            .where(and(eq(tokTable.platform, "facebook"), eq(tokTable.isActive, true)))
            .limit(1);

          if (fbToken) {
            // Auto-download the video at 720p if this was a metadata-only job
            const [currentJob] = await db.select().from(videoJobsTable).where(eq(videoJobsTable.id, id));
            const videoUrl = currentJob?.youtubeUrl?.trim() ?? "";
            if (!videoUrl) throw new Error("Cannot publish to Facebook: job has no source video URL.");
            if (!currentJob?.videoPath || !existsSync(currentJob.videoPath)) {
              req.log.info({ jobId: id }, "No video file found — downloading at 720p before Facebook publish");
              await downloadVideoForJob(id, videoUrl, "720p");
            }
            req.log.info({ jobId: id }, "Publishing to Facebook Page via Graph API");
            const result = await publishToFacebook(id);
            await updatePublishLog(id, platform, "success", result.url);
          } else {
            req.log.info({ jobId: id }, "No Facebook token — using simulator");
            await new Promise((r) => setTimeout(r, 2500));
            await updatePublishLog(id, platform, "success", `https://facebook.com/video/sim-${id}-${Date.now()}`);
          }
        } else {
          await new Promise((r) => setTimeout(r, 2000));
          await updatePublishLog(
            id,
            platform,
            "success",
            `https://${platform}.com/posts/sim-${id}`
          );
        }
        succeeded.add(platform);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Publish failed";
        req.log.error({ err, jobId: id, platform }, "Publish pipeline error");
        await updatePublishLog(id, platform, "failed", undefined, msg).catch(() => {});
        if (!failedPlatform) { failedPlatform = platform; failMsg = msg; }
      }
    }

    if (failedPlatform) {
      // At least one platform failed — mark job failed with the first error;
      // successfully published platforms already have their logs preserved.
      await db
        .update(videoJobsTable)
        .set({ status: "failed", errorMessage: failMsg })
        .where(eq(videoJobsTable.id, id));
    } else {
      await db
        .update(videoJobsTable)
        .set({ status: "published", progress: 100 })
        .where(eq(videoJobsTable.id, id));
    }
  })();

  res.json(updated);
});

export default router;
