import pg from "pg";

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("[DB] DATABASE_URL not set — skipping schema sync.");
  process.exit(0);
}

const pool = new Pool({
  connectionString: databaseUrl,
  connectionTimeoutMillis: 15000,
});

const statements = [
  `CREATE TABLE IF NOT EXISTS video_jobs (
    id SERIAL PRIMARY KEY,
    youtube_url TEXT,
    title TEXT,
    original_title TEXT,
    original_description TEXT,
    description TEXT,
    tags TEXT,
    hashtags TEXT,
    thumbnail_url TEXT,
    selected_thumbnail_id INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',
    publish_mode TEXT DEFAULT 'manual',
    scheduled_at TEXT,
    platforms TEXT,
    error_message TEXT,
    progress INTEGER DEFAULT 0,
    video_path TEXT,
    duration INTEGER,
    quality TEXT,
    codec TEXT,
    mission_type TEXT DEFAULT 'normal',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP
  );`,
  `ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS original_description TEXT;`,
  `ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS quality TEXT;`,
  `ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS codec TEXT;`,
  `ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS mission_type TEXT DEFAULT 'normal';`,
  `ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS video_path TEXT;`,
  `ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS duration INTEGER;`,
  `ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS hashtags TEXT;`,

  `CREATE TABLE IF NOT EXISTS thumbnails (
    id SERIAL PRIMARY KEY,
    job_id INTEGER NOT NULL,
    variant_index INTEGER NOT NULL DEFAULT 0,
    image_url TEXT NOT NULL,
    label TEXT,
    is_selected BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );`,

  `CREATE TABLE IF NOT EXISTS api_tokens (
    id SERIAL PRIMARY KEY,
    platform TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    label TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );`,

  `CREATE TABLE IF NOT EXISTS channels (
    id SERIAL PRIMARY KEY,
    platform TEXT NOT NULL,
    channel_name TEXT NOT NULL,
    channel_id TEXT,
    thumbnail_url TEXT,
    subscriber_count INTEGER,
    token_id INTEGER,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );`,
  `ALTER TABLE channels ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;`,

  `CREATE TABLE IF NOT EXISTS publish_logs (
    id SERIAL PRIMARY KEY,
    job_id INTEGER NOT NULL,
    platform TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    platform_video_id TEXT,
    platform_url TEXT,
    error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );`,

  `CREATE TABLE IF NOT EXISTS app_config (
    id SERIAL PRIMARY KEY,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS app_config_key_unique ON app_config (key);`,
];

async function main() {
  console.log("[DB] Syncing PostgreSQL schema (non-interactive)...");
  const client = await pool.connect();
  try {
    for (const sql of statements) {
      await client.query(sql);
    }
    console.log("[DB] Schema sync complete.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[DB] Schema sync failed:", err);
  process.exit(1);
});
