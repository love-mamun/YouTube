import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import { db, publishLogsTable } from "@workspace/db";
import { ListPublishLogsQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/publish-logs", async (req, res): Promise<void> => {
  const params = ListPublishLogsQueryParams.safeParse(req.query);
  const limit = params.success ? (params.data.limit ?? 50) : 50;

  const logs = await db
    .select()
    .from(publishLogsTable)
    .orderBy(desc(publishLogsTable.createdAt))
    .limit(Number(limit));

  res.json(logs);
});

export default router;
