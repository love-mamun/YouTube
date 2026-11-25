import app from "./app";
import { logger } from "./lib/logger";
import { startCleanupScheduler } from "./lib/cleanup-scheduler";
import { resumeStuckJobs } from "./lib/video-processor";
import { seedSettingsPassword } from "./routes/auth";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startCleanupScheduler();

  // Seed settings password from SETTINGS_PASSWORD env var (only if not already in DB)
  seedSettingsPassword().catch((err) =>
    logger.error({ err }, "seedSettingsPassword failed on startup")
  );

  // Resume any jobs that were interrupted by a server restart
  resumeStuckJobs().catch((err) =>
    logger.error({ err }, "resumeStuckJobs failed on startup")
  );
});
