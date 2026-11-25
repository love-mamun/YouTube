import { Router, type IRouter } from "express";
import healthRouter from "./health";
import jobsRouter from "./jobs";
import contentRouter from "./content";
import thumbnailsRouter from "./thumbnails";
import tokensRouter from "./tokens";
import channelsRouter from "./channels";
import statsRouter from "./stats";
import publishLogsRouter from "./publish-logs";
import youtubeAuthRouter from "./youtube-auth";
import facebookAuthRouter from "./facebook-auth";
import settingsRouter from "./settings";
import youtubeApiRouter from "./youtube-api";
import authRouter from "./auth";
import { requireSettingsAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.use(healthRouter);
// Auth endpoints (login/logout/status/change-password) — public
router.use(authRouter);

// Everything below requires settings auth ─────────────────────────────────
router.use(requireSettingsAuth, youtubeAuthRouter);
router.use(requireSettingsAuth, facebookAuthRouter);
router.use(requireSettingsAuth, settingsRouter);
router.use(requireSettingsAuth, youtubeApiRouter);
router.use(requireSettingsAuth, tokensRouter);
router.use(requireSettingsAuth, channelsRouter);

// Job-related routes — protected but separate so publish flows work
router.use(requireSettingsAuth, jobsRouter);
router.use(requireSettingsAuth, contentRouter);
router.use(requireSettingsAuth, thumbnailsRouter);
router.use(requireSettingsAuth, statsRouter);
router.use(requireSettingsAuth, publishLogsRouter);

export default router;
