# N3XUS Auto Video Publisher

A full-stack SaaS that lets users paste a YouTube URL and automatically downloads metadata, generates AI-powered SEO content (title, description, tags, hashtags) via Gemini, creates thumbnail variants, and publishes to YouTube/Facebook.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000 → proxied at /api)
- `pnpm --filter @workspace/n3xus run dev` — run the frontend (port 23033 → proxied at /)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Required env: `GEMINI_API_KEY` — Google Gemini AI key (get free at https://aistudio.google.com/apikey)
- Required env: `SESSION_SECRET` — session signing secret

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite (wouter routing, framer-motion, lucide-react, date-fns)
- API: Express 5 (port 8080, proxied at /api)
- DB: PostgreSQL + Drizzle ORM
- AI: Google Gemini 2.0 Flash (direct REST API, no SDK dependency)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — source of truth for all API contracts
- `lib/api-zod/src/generated/api.ts` — generated Zod schemas (run codegen to update)
- `lib/api-client-react/src/generated/api.ts` — generated React Query hooks
- `lib/db/src/schema/` — DB schema files (videoJobs, thumbnails, apiTokens, channels, publishLogs)
- `artifacts/api-server/src/routes/` — all Express route handlers (jobs, content, thumbnails, tokens, channels, stats, publish-logs)
- `artifacts/api-server/src/lib/` — AI content generation (ai-content.ts), video processing pipeline (video-processor.ts)
- `artifacts/n3xus/src/pages/` — frontend pages (dashboard, jobs, job-detail, new-job, settings, logs)
- `artifacts/n3xus/src/components/` — Layout, StatusBadge, JobPipeline components

## Architecture decisions

- **Contract-first API**: OpenAPI spec drives all validation (Zod) and client hooks (React Query) via Orval codegen. Never write validators by hand.
- **In-memory processing pipeline**: Job stages (downloading → processing → generating → ready) use setTimeout-based progression — no Redis/queue needed for MVP.
- **Gemini via direct REST**: Using fetch() to the Gemini REST API instead of the SDK to keep bundle size small. Falls back gracefully if API key is missing or quota exceeded.
- **YouTube metadata via oEmbed**: No YouTube Data API key required — title fetched via free oEmbed endpoint; thumbnails use the standard CDN URL pattern (`img.youtube.com/vi/<id>/maxresdefault.jpg`).
- **Secrets never in code**: GEMINI_API_KEY and other secrets accessed only via `process.env`, stored in Replit Secrets.

## Product

- **Dashboard**: Mission Control view with live stats (total jobs, published today, in queue, total published) and recent activity feed
- **New Mission**: Paste YouTube URL, choose publish mode (manual/auto/scheduled) and target platforms
- **Job Detail**: Full pipeline status tracker, editable AI-generated title/description/tags/hashtags, 4 thumbnail variant selector, Approve + Publish buttons
- **All Jobs**: Paginated job list with status badges and quick actions
- **Settings**: API token management (YouTube, Facebook OAuth tokens)
- **Telemetry Logs**: Full publish log history across all platforms

## User preferences

- Dark "mission control" theme: background #0a0a0f, cyan primary #00d4ff, Space Grotesk font
- Monospace accents with JetBrains Mono for labels and codes

## Gotchas

- `@import url(...)` for Google Fonts must be the FIRST line in index.css (before @import "tailwindcss") or PostCSS throws a parse error
- Express 5 wildcard routes use `/{*splat}` not `*`
- After any route file changes, restart the api-server workflow to trigger rebuild
- The api-server build bundles everything into `dist/index.mjs` — always restart workflow, never run node directly

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
