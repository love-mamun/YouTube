import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, videoJobsTable, thumbnailsTable } from "@workspace/db";
import {
  GetJobThumbnailsParams,
  SelectThumbnailParams,
  SelectThumbnailBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/jobs/:id/thumbnails", async (req, res): Promise<void> => {
  const params = GetJobThumbnailsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid job ID" });
    return;
  }

  const thumbs = await db
    .select()
    .from(thumbnailsTable)
    .where(eq(thumbnailsTable.jobId, params.data.id));

  res.json(thumbs);
});

router.post("/jobs/:id/select-thumbnail", async (req, res): Promise<void> => {
  const params = SelectThumbnailParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid job ID" });
    return;
  }

  const body = SelectThumbnailBody.safeParse(req.body);
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

  // Verify the thumbnail actually belongs to this job
  const [thumb] = await db
    .select()
    .from(thumbnailsTable)
    .where(eq(thumbnailsTable.id, body.data.thumbnailId));

  if (!thumb || thumb.jobId !== params.data.id) {
    res.status(404).json({ error: "Thumbnail not found for this job" });
    return;
  }

  // Deselect all thumbnails for this job
  await db
    .update(thumbnailsTable)
    .set({ isSelected: false })
    .where(eq(thumbnailsTable.jobId, params.data.id));

  // Select the chosen one
  await db
    .update(thumbnailsTable)
    .set({ isSelected: true })
    .where(eq(thumbnailsTable.id, body.data.thumbnailId));

  const [updated] = await db
    .update(videoJobsTable)
    .set({ selectedThumbnailId: body.data.thumbnailId })
    .where(eq(videoJobsTable.id, params.data.id))
    .returning();

  res.json(updated);
});

export default router;
