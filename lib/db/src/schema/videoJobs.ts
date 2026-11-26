import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const videoJobsTable = pgTable("video_jobs", {
  id: serial("id").primaryKey(),
  youtubeUrl: text("youtube_url"),
  title: text("title"),
  originalTitle: text("original_title"),
  originalDescription: text("original_description"),
  description: text("description"),
  tags: text("tags"),
  hashtags: text("hashtags"),
  thumbnailUrl: text("thumbnail_url"),
  selectedThumbnailId: integer("selected_thumbnail_id"),
  status: text("status").notNull().default("pending"),
  publishMode: text("publish_mode").default("manual"),
  scheduledAt: text("scheduled_at"),
  platforms: text("platforms"),
  errorMessage: text("error_message"),
  progress: integer("progress").default(0),
  videoPath: text("video_path"),
  duration: integer("duration"),
  quality: text("quality"),
  codec: text("codec"),
  missionType: text("mission_type").default("normal"),
  aspectMode: text("aspect_mode"),
  clipStartSecs: integer("clip_start_secs"),
  clipMaxSecs: integer("clip_max_secs"),
  audioNormalize: text("audio_normalize"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at"),
});

export const insertVideoJobSchema = createInsertSchema(videoJobsTable).omit({ id: true, createdAt: true });
export type InsertVideoJob = z.infer<typeof insertVideoJobSchema>;
export type VideoJob = typeof videoJobsTable.$inferSelect;
