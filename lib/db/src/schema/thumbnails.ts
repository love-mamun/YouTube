import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const thumbnailsTable = pgTable("thumbnails", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull(),
  variantIndex: integer("variant_index").notNull().default(0),
  imageUrl: text("image_url").notNull(),
  label: text("label"),
  isSelected: boolean("is_selected").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertThumbnailSchema = createInsertSchema(thumbnailsTable).omit({ id: true, createdAt: true });
export type InsertThumbnail = z.infer<typeof insertThumbnailSchema>;
export type Thumbnail = typeof thumbnailsTable.$inferSelect;
