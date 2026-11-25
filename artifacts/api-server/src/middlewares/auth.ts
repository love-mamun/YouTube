import type { Request, Response, NextFunction } from "express";

/**
 * Middleware: reject requests that don't have a valid settings session.
 * Applied to all /api/settings/* routes.
 */
export function requireSettingsAuth(req: Request, res: Response, next: NextFunction): void {
  if ((req.session as any)?.settingsAuthed === true) {
    next();
    return;
  }
  res.status(401).json({ error: "Unauthorized — please log in to access settings." });
}
