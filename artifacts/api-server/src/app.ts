import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import router from "./routes";
import { logger } from "./lib/logger";
import { existsSync } from "fs";
import * as path from "path";
import * as url from "url";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// Restrict CORS to the known frontend origin(s).
// In dev the Vite proxy forwards /api, so the browser never hits port 8080
// directly — but we still lock down origins defensively.
const allowedOrigins = [
  // Replit proxied preview (set by the platform)
  ...(process.env.REPLIT_DEV_DOMAIN
    ? [`https://${process.env.REPLIT_DEV_DOMAIN}`]
    : []),
  // Local dev fallback
  "http://localhost:5000",
  "http://localhost:3001",
];
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server requests (no Origin header) and listed origins
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin not allowed — ${origin}`));
      }
    },
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session — used for settings auth gate
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  throw new Error("SESSION_SECRET environment variable is required but not set.");
}
app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: "lax",
    },
  }),
);

app.use("/api", router);

// Serve watermark logo and other assets so the frontend can preview them
app.use("/api/assets", express.static("/home/runner/workspace/artifacts/api-server/assets"));

if (process.env.NODE_ENV === "production") {
  // Production: serve the built Vite frontend
  const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
  const frontendDir = path.resolve(__dirname, "..", "..", "n3xus", "dist", "public");

  if (existsSync(frontendDir)) {
    logger.info({ frontendDir }, "Serving frontend static files");
    app.use(express.static(frontendDir));
    app.get("/{*splat}", (_req, res) => {
      res.sendFile(path.join(frontendDir, "index.html"));
    });
  } else {
    logger.warn({ frontendDir }, "Frontend dist not found — skipping static serving");
  }
} else {
  // Development: proxy everything non-API to the Vite dev server
  const { createProxyMiddleware } = await import("http-proxy-middleware");
  const vitePort = process.env.VITE_PORT || "5000";
  const viteProxy = createProxyMiddleware({
    target: `http://localhost:${vitePort}`,
    changeOrigin: true,
    ws: true,
    logger: console,
  });
  app.use(viteProxy);
}

export default app;
