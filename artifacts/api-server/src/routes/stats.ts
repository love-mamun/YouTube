import { Router, type IRouter } from "express";
import { eq, desc, gte, sql } from "drizzle-orm";
import { db, videoJobsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/stats", async (_req, res): Promise<void> => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [counts] = await db
    .select({
      totalJobs: sql<number>`count(*)::int`,
      publishedToday: sql<number>`count(*) filter (where status = 'published' and created_at >= ${todayStart.toISOString()})::int`,
      pendingJobs: sql<number>`count(*) filter (where status in ('pending', 'ready', 'approved'))::int`,
      failedJobs: sql<number>`count(*) filter (where status = 'failed')::int`,
      totalPublished: sql<number>`count(*) filter (where status = 'published')::int`,
      processingJobs: sql<number>`count(*) filter (where status in ('downloading', 'processing', 'generating', 'publishing'))::int`,
    })
    .from(videoJobsTable);

  const recentActivity = await db
    .select()
    .from(videoJobsTable)
    .orderBy(desc(videoJobsTable.createdAt))
    .limit(5);

  res.json({
    totalJobs: counts.totalJobs ?? 0,
    publishedToday: counts.publishedToday ?? 0,
    pendingJobs: counts.pendingJobs ?? 0,
    failedJobs: counts.failedJobs ?? 0,
    totalPublished: counts.totalPublished ?? 0,
    processingJobs: counts.processingJobs ?? 0,
    recentActivity,
  });
});

export default router;
