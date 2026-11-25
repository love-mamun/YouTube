import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const apiTokensTable = pgTable("api_tokens", {
  id: serial("id").primaryKey(),
  platform: text("platform").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  label: text("label"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertApiTokenSchema = createInsertSchema(apiTokensTable).omit({ id: true, createdAt: true });
export type InsertApiToken = z.infer<typeof insertApiTokenSchema>;
export type ApiToken = typeof apiTokensTable.$inferSelect;
