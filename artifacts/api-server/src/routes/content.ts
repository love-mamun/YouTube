import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, videoJobsTable } from "@workspace/db";
import {
  GetJobContentParams,
  UpdateJobContentParams,
  UpdateJobContentBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

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

export default router;
