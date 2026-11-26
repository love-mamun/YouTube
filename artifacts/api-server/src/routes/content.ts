import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import * as zod from "zod";
import { db, videoJobsTable } from "@workspace/db";
import {
  GetJobContentParams,
  UpdateJobContentParams,
  UpdateJobContentBody,
  RegenerateContentParams,
} from "@workspace/api-zod";
import { generateAiContent, type AiCopyStyle } from "../lib/ai-content";

const router: IRouter = Router();

const RegenerateContentBodySchema = zod.object({
  copyStyle: zod.enum(["short", "long"]).optional(),
  feedback: zod.string().max(500).optional(),
});

router.get("/jobs/:id/content", async (req, res): Promise<void> => {
  const params = GetJobContentParams.safeParse(req.params);
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

  res.json({
    jobId: job.id,
    title: job.title,
    description: job.description,
    tags: job.tags,
    hashtags: job.hashtags ?? null,
  });
});

router.put("/jobs/:id/content", async (req, res): Promise<void> => {
  const params = UpdateJobContentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid job ID" });
    return;
  }

  const body = UpdateJobContentBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
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

  const newTitle = body.data.title ?? job.title;
  const newDescription = body.data.description ?? job.description;
  const newTags = body.data.tags ?? job.tags;
  const newHashtags = body.data.hashtags ?? job.hashtags;

  await db
    .update(videoJobsTable)
    .set({
      title: newTitle,
      description: newDescription,
      tags: newTags,
      hashtags: newHashtags,
    })
    .where(eq(videoJobsTable.id, job.id));

  res.json({
    jobId: job.id,
    title: newTitle,
    description: newDescription,
    tags: newTags,
    hashtags: newHashtags,
  });
});

router.post("/jobs/:id/regenerate-content", async (req, res): Promise<void> => {
  const params = RegenerateContentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid job ID" });
    return;
  }

  const bodyParsed = RegenerateContentBodySchema.safeParse(req.body ?? {});
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
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

  const platforms = (job.platforms ?? "youtube")
    .split(",")
    .map((p: string) => p.trim())
    .filter(Boolean);

  const isVertical =
    job.aspectMode === "vertical_blur" || job.aspectMode === "vertical_crop";
  const inferredStyle: AiCopyStyle =
    bodyParsed.data.copyStyle ??
    (platforms.includes("youtube-shorts") ||
    isVertical ||
    (job.duration != null && job.duration > 0 && job.duration <= 65)
      ? "short"
      : "long");

  const generated = await generateAiContent(
    job.originalTitle || job.title || "Untitled Video",
    job.originalDescription ?? job.description ?? undefined,
    bodyParsed.data.feedback,
    job.tags ?? undefined,
    { copyStyle: inferredStyle, platforms }
  );

  await db
    .update(videoJobsTable)
    .set({
      title: generated.title,
      description: generated.description,
      tags: generated.tags,
      hashtags: generated.hashtags,
      updatedAt: new Date(),
    })
    .where(eq(videoJobsTable.id, job.id));

  res.json({
    jobId: job.id,
    title: generated.title,
    description: generated.description,
    tags: generated.tags,
    hashtags: generated.hashtags,
    copyStyle: inferredStyle,
  });
});

export default router;
