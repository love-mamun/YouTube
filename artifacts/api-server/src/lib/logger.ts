import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

const VALID_LEVELS = new Set([
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
]);
const rawLevel = process.env.LOG_LEVEL?.trim().toLowerCase();
const level = rawLevel && VALID_LEVELS.has(rawLevel) ? rawLevel : "info";

export const logger = pino({
  level,
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
