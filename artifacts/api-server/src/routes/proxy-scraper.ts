import { Router, type IRouter, type Request, type Response } from "express";
import { getMaskedProxyStatus } from "../lib/ytdlp-config";
import {
  runGithubProxyScrape,
  verifyStoredScraperTriggerToken,
  ScrapeConflictError,
} from "../lib/proxy-scraper";

const router: IRouter = Router();

const FAILED_TOKEN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_TOKEN_ATTEMPTS = 10;
const failedTokenAttempts = new Map<string, { count: number; resetAt: number }>();

function checkFailedTokenRateLimit(ip: string): { allowed: boolean; retryAfterSecs: number } {
  const now = Date.now();
  const entry = failedTokenAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    return { allowed: true, retryAfterSecs: 0 };
  }
  if (entry.count >= MAX_FAILED_TOKEN_ATTEMPTS) {
    return { allowed: false, retryAfterSecs: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSecs: 0 };
}

function recordFailedTokenAttempt(ip: string): void {
  const now = Date.now();
  const prev = failedTokenAttempts.get(ip);
  if (!prev || now > prev.resetAt) {
    failedTokenAttempts.set(ip, { count: 1, resetAt: now + FAILED_TOKEN_WINDOW_MS });
  } else {
    prev.count += 1;
    failedTokenAttempts.set(ip, prev);
  }
}

function extractTriggerToken(req: Request): string | null {
  const authHeader = req.header("authorization");
  if (authHeader && /^Bearer\s+/i.test(authHeader)) {
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (bearer) return bearer;
  }

  const keyHeader = req.header("x-trigger-key")?.trim();
  if (keyHeader) return keyHeader;

  const queryToken = typeof req.query.token === "string" ? req.query.token.trim() : "";
  if (queryToken) return queryToken;

  return null;
}

async function handleProxyScrapeTrigger(req: Request, res: Response): Promise<void> {
  const isSessionAuthed = (req.session as any)?.settingsAuthed === true;
  let triggeredBy: "api_token" | "settings_ui" = "settings_ui";

  if (!isSessionAuthed) {
    const ip = req.ip ?? "unknown";
    const rate = checkFailedTokenRateLimit(ip);
    if (!rate.allowed) {
      res.status(429).json({
        error: `Too many invalid token attempts. Retry in ${rate.retryAfterSecs}s.`,
      });
      return;
    }

    const token = extractTriggerToken(req);
    if (!token) {
      res.status(401).json({
        error: "Unauthorized — provide a valid API trigger token or unlock Settings.",
      });
      return;
    }

    const valid = await verifyStoredScraperTriggerToken(token);
    if (!valid) {
      recordFailedTokenAttempt(ip);
      res.status(401).json({ error: "Invalid or revoked API trigger token." });
      return;
    }

    failedTokenAttempts.delete(ip);
    triggeredBy = "api_token";
  }

  try {
    const report = await runGithubProxyScrape({ triggeredBy });
    const proxyStatus = await getMaskedProxyStatus();
    res.json({
      ...report,
      proxyStatus,
    });
  } catch (err) {
    if (err instanceof ScrapeConflictError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to run GitHub proxy scraper.",
    });
  }
}

// One-call trigger endpoint for external cron jobs / cURL / Settings UI
router.get("/proxy-scraper/run", handleProxyScrapeTrigger);
router.post("/proxy-scraper/run", handleProxyScrapeTrigger);

export default router;
