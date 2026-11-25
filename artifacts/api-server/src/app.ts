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
app.set("trust proxy", 1);

const allowedOrigins = [
  ...(process.env.REPLIT_DEV_DOMAIN
    ? [`https://${process.env.REPLIT_DEV_DOMAIN}`]
    : []),
  ...(process.env.APP_URL ? [process.env.APP_URL] : []),
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5000",
  "http://localhost:3001",
];
app.use(
  cors({
    origin: (origin, callback) => {
      if (
        !origin ||
        allowedOrigins.includes(origin) ||
        /^https:\/\/[a-z0-9.-]+\.run\.app$/i.test(origin)
      ) {
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
const sessionSecret =
  process.env.SESSION_SECRET || "n3xus-dev-session-secret-change-in-production";
app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: "auto",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: "lax",
    },
  }),
);

app.use("/api", router);

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const assetsDir = existsSync(path.resolve(process.cwd(), "artifacts/api-server/assets"))
  ? path.resolve(process.cwd(), "artifacts/api-server/assets")
  : path.resolve(__dirname, "..", "assets");

// Serve watermark logo and other assets so the frontend can preview them
app.use("/api/assets", express.static(assetsDir));

if (process.env.VITE_DEV_PROXY === "true") {
  // Optional dev proxy to separate Vite server
  const { createProxyMiddleware } = await import("http-proxy-middleware");
  const vitePort = process.env.VITE_PORT || "5000";
  const viteProxy = createProxyMiddleware({
    target: `http://localhost:${vitePort}`,
    changeOrigin: true,
    ws: true,
    logger: console,
  });
  app.use(viteProxy);
} else {
  const candidates = [
    path.resolve(process.cwd(), "artifacts/n3xus/dist/public"),
    path.resolve(__dirname, "..", "..", "n3xus", "dist", "public"),
  ];
  const frontendDir = candidates.find((dir) => existsSync(dir)) ?? candidates[0];

  if (existsSync(frontendDir)) {
    logger.info({ frontendDir }, "Serving frontend static files");
    app.use(express.static(frontendDir));
    app.get("/{*splat}", (_req, res) => {
      res.sendFile(path.join(frontendDir, "index.html"));
    });
  } else {
    logger.warn({ frontendDir }, "Frontend dist not found — skipping static serving");
  }
}

export default app;
