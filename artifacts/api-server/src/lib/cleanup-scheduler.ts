import { readdirSync, statSync, unlinkSync, existsSync } from "fs";
import * as os from "os";
import * as path from "path";
import { eq, isNotNull, inArray } from "drizzle-orm";
import { db, videoJobsTable } from "@workspace/db";
import { logger } from "./logger";
import { getVideoStoreDir, getDiskSpaceInfo } from "./ytdlp-config";

const STALE_SWEEP_INTERVAL_MS = 30 * 60 * 1000;

async function getProtectedJobIds(): Promise<Set<number>> {
  const protectedJobIds = new Set<number>();
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
    logger.warn({ err: e }, "Could not query protected jobs during cleanup");
  }
  return protectedJobIds;
}

async function runCleanup(options: { onlyOrphaned?: boolean } = {}) {
  const { onlyOrphaned = false } = options;
  const storeDir = getVideoStoreDir();
  logger.info({ onlyOrphaned, storeDir }, "Running scheduled video file cleanup");

  let deletedFiles = 0;
  let deletedBytes = 0;

  const protectedJobIds = onlyOrphaned ? await getProtectedJobIds() : new Set<number>();

  if (existsSync(storeDir)) {
    try {
      const files = readdirSync(storeDir);
      for (const file of files) {
        if (onlyOrphaned) {
          const m = file.match(/^(?:job|pub)-(\d+)-/);
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

/**
 * Reclaim disk space right before starting a download on tight 2 GB temp storage.
 * 1) Deletes orphaned / published / failed / partial files first.
 * 2) If free disk is still below `minFreeMB`, evicts oldest cached ready/approved
 *    files (jobs not actively downloading/processing/publishing) so the new download
 *    won't hit ENOSPC; evicted jobs can still re-download on publish.
 */
export async function reclaimTempSpaceIfNeeded(
  minFreeMB = 900,
  excludeJobId?: number
): Promise<{ reclaimedMB: number; availableMB: number | null }> {
  const storeDir = getVideoStoreDir();
  await runCleanup({ onlyOrphaned: true });

  let disk = getDiskSpaceInfo(storeDir);
  if (disk.availableMB === null || disk.availableMB >= minFreeMB) {
    return { reclaimedMB: 0, availableMB: disk.availableMB };
  }

  let reclaimedBytes = 0;
  try {
    const activeRows = await db
      .select({ id: videoJobsTable.id })
      .from(videoJobsTable)
      .where(inArray(videoJobsTable.status, ["downloading", "processing", "generating", "publishing"]));
    const activeIds = new Set(activeRows.map((r) => r.id));
    if (excludeJobId !== undefined) activeIds.add(excludeJobId);

    if (existsSync(storeDir)) {
      const candidates = readdirSync(storeDir)
        .map((name) => {
          const fullPath = path.join(storeDir, name);
          try {
            const st = statSync(fullPath);
            return { name, fullPath, size: st.size, mtimeMs: st.mtimeMs };
          } catch {
            return null;
          }
        })
        .filter((f): f is NonNullable<typeof f> => Boolean(f))
        .sort((a, b) => a.mtimeMs - b.mtimeMs);

      for (const file of candidates) {
        const m = file.name.match(/^(?:job|pub)-(\d+)-/);
        const fileJobId = m ? parseInt(m[1], 10) : null;
        if (fileJobId !== null && activeIds.has(fileJobId)) continue;

        try {
          unlinkSync(file.fullPath);
          reclaimedBytes += file.size;
          if (fileJobId !== null) {
            await db
              .update(videoJobsTable)
              .set({ videoPath: null })
              .where(eq(videoJobsTable.id, fileJobId))
              .catch(() => {});
          }
          logger.info(
            { file: file.name, freedMB: (file.size / (1024 * 1024)).toFixed(1) },
            "Evicted cached temp video to free space for next download"
          );
        } catch {
          // noop
        }

        disk = getDiskSpaceInfo(storeDir);
        if (disk.availableMB !== null && disk.availableMB >= minFreeMB) break;
      }
    }
  } catch (err) {
    logger.warn({ err }, "Failed while reclaiming cached temp space");
  }

  return {
    reclaimedMB: Math.round(reclaimedBytes / (1024 * 1024)),
    availableMB: getDiskSpaceInfo(storeDir).availableMB,
  };
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

  setInterval(() => {
    runCleanup({ onlyOrphaned: true }).catch((e) =>
      logger.warn({ err: e }, "Periodic orphan cleanup failed")
    );
  }, STALE_SWEEP_INTERVAL_MS);

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
