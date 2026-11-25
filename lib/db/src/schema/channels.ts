import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const channelsTable = pgTable("channels", {
  id: serial("id").primaryKey(),
  platform: text("platform").notNull(),
  channelName: text("channel_name").notNull(),
  channelId: text("channel_id"),
  thumbnailUrl: text("thumbnail_url"),
  subscriberCount: integer("subscriber_count"),
  tokenId: integer("token_id"),
  isActive: boolean("is_active").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertChannelSchema = createInsertSchema(channelsTable).omit({ id: true, createdAt: true });
export type InsertChannel = z.infer<typeof insertChannelSchema>;
export type Channel = typeof channelsTable.$inferSelect;
