import { readdirSync, statSync, unlinkSync, existsSync } from "fs";
import * as os from "os";
import * as path from "path";
import { eq, isNotNull, inArray } from "drizzle-orm";
import { db, videoJobsTable } from "@workspace/db";
import { logger } from "./logger";
import { getVideoStoreDir } from "./ytdlp-config";

async function runCleanup(options: { onlyOrphaned?: boolean } = {}) {
  const { onlyOrphaned = false } = options;
  const storeDir = getVideoStoreDir();
  logger.info({ onlyOrphaned, storeDir }, "Running scheduled video file cleanup");

  let deletedFiles = 0;
  let deletedBytes = 0;

  const protectedJobIds = new Set<number>();
  if (onlyOrphaned) {
    try {
      const keepRows = await db
        .select({ id: videoJobsTable.id })
        .from(videoJobsTable)
        .where(
          inArray(videoJobsTable.status, [
            "pending",
            "downloading",
            "processing",
            "generating",
            "ready",
            "approved",
            "publishing",
          ])
        );
      for (const r of keepRows) protectedJobIds.add(r.id);
    } catch (e) {
      logger.warn({ err: e }, "Could not query protected jobs during startup cleanup");
    }
  }

  if (existsSync(storeDir)) {
    try {
      const files = readdirSync(storeDir);
      for (const file of files) {
        if (onlyOrphaned) {
          const m = file.match(/^job-(\d+)-/);
          if (m && protectedJobIds.has(parseInt(m[1], 10))) {
            continue;
          }
        }
        const fullPath = path.join(storeDir, file);
        try {
          const stat = statSync(fullPath);
          deletedBytes += stat.size;
          unlinkSync(fullPath);
          deletedFiles++;
          logger.info({ file }, "Deleted stale video file");
        } catch (e) {
          logger.warn({ file, err: e }, "Could not stat/delete file");
        }
      }
    } catch (e) {
      logger.warn({ err: e }, "Could not read video store dir");
    }
  }

  // Also sweep any leftover /tmp/n3xus_*.mp4 publish temps
  try {
    const tmpRoot = os.tmpdir();
    for (const entry of readdirSync(tmpRoot)) {
      if (entry.startsWith("n3xus_") && entry.endsWith(".mp4")) {
        const fullPath = path.join(tmpRoot, entry);
        try {
          const stat = statSync(fullPath);
          if (!onlyOrphaned || Date.now() - stat.mtimeMs > 15 * 60 * 1000) {
            deletedBytes += stat.size;
            unlinkSync(fullPath);
            deletedFiles++;
          }
        } catch {
          // noop
        }
      }
    }
  } catch {
    // noop
  }

  // Clear videoPath in DB for jobs whose file no longer exists
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
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime() - now.getTime();
}

export function startCleanupScheduler() {
  // On startup only clean orphaned files so active/ready/approved jobs can resume intact
  runCleanup({ onlyOrphaned: true }).catch((e) => logger.warn({ err: e }, "Startup cleanup failed"));

  function scheduleNext() {
    const delay = msUntilMidnight();
    const nextMidnight = new Date(Date.now() + delay);
    logger.info(
      { nextRunAt: nextMidnight.toISOString() },
      "Video cleanup scheduled for midnight"
    );

    setTimeout(() => {
      runCleanup({ onlyOrphaned: false })
        .catch((e) => logger.warn({ err: e }, "Midnight cleanup failed"))
        .finally(() => scheduleNext());
    }, delay);
  }

  scheduleNext();
}
