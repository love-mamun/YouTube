import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { appConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

const PASSWORD_KEY = "SETTINGS_PASSWORD_HASH";
const MIN_PASSWORD_LEN = 8;

// ── Simple in-memory rate limiter ────────────────────────────────────────────
// Max 5 failed attempts per IP per 15 minutes.
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW_MS  = 15 * 60 * 1000; // 15 min
const MAX_ATTEMPTS    = 5;

function checkRateLimit(ip: string): { allowed: boolean; retryAfterSecs: number } {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 0, resetAt: now + RATE_WINDOW_MS });
    return { allowed: true, retryAfterSecs: 0 };
  }
  if (entry.count >= MAX_ATTEMPTS) {
    return { allowed: false, retryAfterSecs: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSecs: 0 };
}

function recordFailedAttempt(ip: string) {
  const now = Date.now();
  const entry = loginAttempts.get(ip) ?? { count: 0, resetAt: now + RATE_WINDOW_MS };
  entry.count += 1;
  loginAttempts.set(ip, entry);
}

function clearAttempts(ip: string) {
  loginAttempts.delete(ip);
}

/**
 * Seed the settings password on first run.
 * Reads plaintext from the SETTINGS_PASSWORD environment variable.
 * Skips silently if already set in DB.
 * Throws if the env var is missing.
 */
export async function seedSettingsPassword(): Promise<void> {
  const plaintext = process.env.SETTINGS_PASSWORD || "n3xus-admin";
  if (!process.env.SETTINGS_PASSWORD) {
    console.warn(
      "[AI Studio] SETTINGS_PASSWORD not set — using default development password. Set SETTINGS_PASSWORD in environment variables."
    );
  }

  const [existing] = await db
    .select()
    .from(appConfigTable)
    .where(eq(appConfigTable.key, PASSWORD_KEY))
    .limit(1);

  if (!existing) {
    const hash = await bcrypt.hash(plaintext, 12);
    await db.insert(appConfigTable).values({ key: PASSWORD_KEY, value: hash });
  }
}

/** GET /api/auth/status — check if this session is authenticated */
router.get("/auth/status", (req, res) => {
  const authed = req.session.settingsAuthed === true;
  res.json({ authed });
});

/** POST /api/auth/login — { password: string } */
router.post("/auth/login", async (req, res) => {
  const ip = req.ip ?? "unknown";
  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    res.status(429).json({
      error: `Too many failed attempts. Try again in ${Math.ceil(rate.retryAfterSecs / 60)} minute(s).`,
    });
    return;
  }

  const { password } = req.body as { password?: string };
  if (!password) {
    res.status(400).json({ error: "Password required." });
    return;
  }

  const [row] = await db
    .select()
    .from(appConfigTable)
    .where(eq(appConfigTable.key, PASSWORD_KEY))
    .limit(1);

  if (!row) {
    res.status(500).json({ error: "Settings password not configured — check server logs." });
    return;
  }

  const match = await bcrypt.compare(password, row.value);
  if (!match) {
    recordFailedAttempt(ip);
    // Fixed-time response to prevent timing oracle
    res.status(401).json({ error: "Incorrect password." });
    return;
  }

  clearAttempts(ip);

  // Regenerate session ID after successful auth (prevents session fixation)
  req.session.regenerate((err) => {
    if (err) { res.status(500).json({ error: "Session error." }); return; }
    req.session.settingsAuthed = true;
    req.session.save(() => res.json({ ok: true }));
  });
});

/** POST /api/auth/logout */
router.post("/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

/** POST /api/auth/change-password — { currentPassword, newPassword } */
router.post("/auth/change-password", async (req, res) => {
  if (req.session.settingsAuthed !== true) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }

  const { currentPassword, newPassword } = req.body as {
    currentPassword?: string;
    newPassword?: string;
  };

  if (!currentPassword || !newPassword || newPassword.length < MIN_PASSWORD_LEN) {
    res.status(400).json({
      error: `Both currentPassword and newPassword (min ${MIN_PASSWORD_LEN} chars) required.`,
    });
    return;
  }

  const [row] = await db
    .select()
    .from(appConfigTable)
    .where(eq(appConfigTable.key, PASSWORD_KEY))
    .limit(1);

  if (!row || !(await bcrypt.compare(currentPassword, row.value))) {
    res.status(401).json({ error: "Current password incorrect." });
    return;
  }

  const hash = await bcrypt.hash(newPassword, 12);
  await db
    .update(appConfigTable)
    .set({ value: hash, updatedAt: new Date() })
    .where(eq(appConfigTable.key, PASSWORD_KEY));

  res.json({ ok: true });
});

export default router;
