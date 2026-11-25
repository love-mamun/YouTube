import app from "./app";
import { ensureSchema } from "@workspace/db";
import { logger } from "./lib/logger";
import { startCleanupScheduler } from "./lib/cleanup-scheduler";
import { resumeStuckJobs } from "./lib/video-processor";
import { seedSettingsPassword } from "./routes/auth";
import { syncCookiesFromDb } from "./lib/ytdlp-config";

const rawPort = process.env["PORT"] || "3000";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function startServer() {
  try {
    await ensureSchema();
    await syncCookiesFromDb().catch((err) =>
      logger.warn({ err }, "syncCookiesFromDb failed on startup")
    );
    await seedSettingsPassword().catch((err) =>
      logger.error({ err }, "seedSettingsPassword failed on startup")
    );
  } catch (err) {
    logger.error({ err }, "ensureSchema failed on startup");
  }

  app.listen(port, "0.0.0.0", (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
    startCleanupScheduler();
    resumeStuckJobs().catch((err) =>
      logger.error({ err }, "resumeStuckJobs failed on startup")
    );
  });
}

void startServer();
