import { Router, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
import * as zod from "zod";
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
import { startVideoProcessing, downloadVideoForJob, cleanupJobVideoFile } from "../lib/video-processor";
import { publishToYouTube, updatePublishLog } from "../lib/youtube-publisher";
import { publishToFacebook } from "../lib/facebook-publisher";
import { registerJobAbort, clearJobAbort, abortActiveJob } from "../lib/job-registry";
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

const ExtendedCreateJobBody = CreateJobBody.extend({
  aspectMode: zod.enum(["source", "vertical_blur", "vertical_crop"]).optional(),
  clipStartSecs: zod.number().int().min(0).max(36000).nullish(),
  clipMaxSecs: zod.number().int().min(5).max(300).nullish(),
  audioNormalize: zod.boolean().optional(),
});

router.post("/jobs", async (req, res): Promise<void> => {
  const parsed = ExtendedCreateJobBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const {
    youtubeUrl,
    publishMode,
    platforms,
    scheduledAt,
    quality,
    codec,
    missionType,
    aspectMode,
    clipStartSecs,
    clipMaxSecs,
    audioNormalize,
  } = parsed.data;

  const [job] = await db
    .insert(videoJobsTable)
    .values({
      youtubeUrl,
      publishMode: publishMode || "manual",
      platforms: platforms || "youtube",
      scheduledAt: scheduledAt ?? null,
      quality: quality ?? null,
      codec: codec ?? null,
      missionType: missionType ?? "normal",
      aspectMode: aspectMode ?? "source",
      clipStartSecs: clipStartSecs ?? null,
      clipMaxSecs: clipMaxSecs ?? null,
      audioNormalize: audioNormalize ? "loudnorm" : null,
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

  const id = params.data.id;
  abortActiveJob(id, "Deleted by user");
  await cleanupJobVideoFile(id);
  await db.delete(videoJobsTable).where(eq(videoJobsTable.id, id));
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
    publishing:
      job.progress != null && job.progress < 89
        ? `Downloading source video for publish… ${Math.max(0, Math.round(((job.progress - 80) / 9) * 100))}%`
        : `Uploading to platforms… ${Math.max(0, Math.round((((job.progress ?? 89) - 89) / 11) * 100))}%`,
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

  const [updated] = await db
    .update(videoJobsTable)
    .set({ status: "pending", progress: 2, errorMessage: null })
    .where(eq(videoJobsTable.id, job.id))
    .returning();

  startVideoProcessing(job.id, job.youtubeUrl || "").catch((err) => {
    req.log.error({ err, jobId: job.id }, "Background processing failed");
  });

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

router.post("/jobs/:id/cancel", async (req, res): Promise<void> => {
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

  abortActiveJob(id, "Stopped by user");
  if (job.status !== "publishing") {
    await cleanupJobVideoFile(id);
  }

  const nextState =
    job.status === "publishing"
      ? {
          status: "approved",
          progress: 73,
          errorMessage: "[CANCELLED] Publishing stopped by user — click Publish Now to retry.",
        }
      : {
          status: "failed",
          errorMessage: "[CANCELLED] Mission stopped by user — click Retry Mission to run again.",
        };

  const [updated] = await db
    .update(videoJobsTable)
    .set(nextState)
    .where(eq(videoJobsTable.id, id))
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
    .set({ status: "publishing", progress: 80, errorMessage: null })
    .where(eq(videoJobsTable.id, id))
    .returning();

  const pubAbort = registerJobAbort(id);

  (async () => {
    const succeeded = new Set<string>();
    let failedPlatform: string | null = null;
    let failMsg = "";

    try {
      // If multi-platform includes Facebook + no-download, pre-download once into videoPath
      // so both YouTube and Facebook share the same file without downloading twice.
      if (platforms.includes("facebook") && platforms.length > 1) {
        const [cur] = await db.select().from(videoJobsTable).where(eq(videoJobsTable.id, id));
        const videoUrl = cur?.youtubeUrl?.trim() ?? "";
        if (videoUrl && (!cur?.videoPath || !existsSync(cur.videoPath))) {
          await downloadVideoForJob(id, videoUrl, cur?.quality ?? "720p", pubAbort.signal);
        }
      }

      for (const platform of platforms) {
        if (pubAbort.signal.aborted) {
          throw new Error("[CANCELLED] Stopped by user");
        }
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
              const result = await publishToYouTube(id, { isShorts, channelId, signal: pubAbort.signal });
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
                req.log.info({ jobId: id }, "No video file found — downloading before Facebook publish");
                await downloadVideoForJob(id, videoUrl, currentJob?.quality ?? "720p", pubAbort.signal);
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

      if (pubAbort.signal.aborted) {
        return;
      }

      if (failedPlatform) {
        await db
          .update(videoJobsTable)
          .set({ status: "failed", errorMessage: failMsg })
          .where(eq(videoJobsTable.id, id));
      } else {
        await db
          .update(videoJobsTable)
          .set({ status: "published", progress: 100, errorMessage: null })
          .where(eq(videoJobsTable.id, id));
        await cleanupJobVideoFile(id);
      }
    } catch (outerErr) {
      if (pubAbort.signal.aborted) return;
      const msg = outerErr instanceof Error ? outerErr.message : "Publish failed";
      req.log.error({ err: outerErr, jobId: id }, "Unexpected publish failure");
      await db
        .update(videoJobsTable)
        .set({ status: "failed", errorMessage: msg })
        .where(eq(videoJobsTable.id, id))
        .catch(() => {});
    } finally {
      clearJobAbort(id, pubAbort);
    }
  })().catch(async (err) => {
    clearJobAbort(id, pubAbort);
    req.log.error({ err, jobId: id }, "Fatal publish runner error");
    await db
      .update(videoJobsTable)
      .set({ status: "failed", errorMessage: err instanceof Error ? err.message : "Publish failed" })
      .where(eq(videoJobsTable.id, id))
      .catch(() => {});
  });

  res.json(updated);
});

export default router;
