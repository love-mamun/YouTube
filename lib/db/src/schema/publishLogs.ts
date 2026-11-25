import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const publishLogsTable = pgTable("publish_logs", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull(),
  platform: text("platform").notNull(),
  status: text("status").notNull().default("pending"),
  platformVideoId: text("platform_video_id"),
  platformUrl: text("platform_url"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPublishLogSchema = createInsertSchema(publishLogsTable).omit({ id: true, createdAt: true });
export type InsertPublishLog = z.infer<typeof insertPublishLogSchema>;
export type PublishLog = typeof publishLogsTable.$inferSelect;
