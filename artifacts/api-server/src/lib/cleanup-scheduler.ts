import { readdirSync, statSync, unlinkSync } from "fs";
import { existsSync } from "fs";
import { eq, isNotNull } from "drizzle-orm";
import { db, videoJobsTable } from "@workspace/db";
import { logger } from "./logger";

const VIDEO_TMP_DIR = "/home/runner/workspace/.video-store";
// Files deleted at midnight regardless of age

async function runCleanup() {
  logger.info("Running scheduled video file cleanup");

  let deletedFiles = 0;
  let deletedBytes = 0;

  // Delete ALL video files at midnight
  if (existsSync(VIDEO_TMP_DIR)) {
    try {
      const files = readdirSync(VIDEO_TMP_DIR);
      for (const file of files) {
        const fullPath = `${VIDEO_TMP_DIR}/${file}`;
        try {
          const stat = statSync(fullPath);
          deletedBytes += stat.size;
          unlinkSync(fullPath);
          deletedFiles++;
          logger.info({ file }, "Deleted video file at midnight cleanup");
        } catch (e) {
          logger.warn({ file, err: e }, "Could not stat/delete file");
        }
      }
    } catch (e) {
      logger.warn({ err: e }, "Could not read video store dir");
    }
  }

  // Clear videoPath in DB for jobs whose file was deleted
  try {
    const jobs = await db
      .select({ id: videoJobsTable.id, videoPath: videoJobsTable.videoPath })
      .from(videoJobsTable)
      .where(isNotNull(videoJobsTable.videoPath));

    for (const job of jobs) {
      if (job.videoPath && !existsSync(job.videoPath)) {
        await db
          .update(videoJobsTable)
          .set({ videoPath: null })
          .where(eq(videoJobsTable.id, job.id));
        logger.info({ jobId: job.id }, "Cleared missing videoPath from DB");
      }
    }
  } catch (e) {
    logger.warn({ err: e }, "Could not sync DB videoPath after cleanup");
  }

  logger.info(
    { deletedFiles, deletedMB: (deletedBytes / 1024 / 1024).toFixed(1) },
    "Cleanup complete"
  );
}

function msUntilMidnight(): number {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0); // next midnight
  return midnight.getTime() - now.getTime();
}

export function startCleanupScheduler() {
  // Run once at startup to clear any leftover stale files from previous sessions
  runCleanup().catch((e) => logger.warn({ err: e }, "Startup cleanup failed"));

  // Schedule daily at midnight
  function scheduleNext() {
    const delay = msUntilMidnight();
    const nextMidnight = new Date(Date.now() + delay);
    logger.info(
      { nextRunAt: nextMidnight.toISOString() },
      "Video cleanup scheduled for midnight"
    );

    setTimeout(() => {
      runCleanup()
        .catch((e) => logger.warn({ err: e }, "Midnight cleanup failed"))
        .finally(() => scheduleNext()); // re-schedule for next midnight
    }, delay);
  }

  scheduleNext();
}
