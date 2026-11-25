import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const appConfigTable = pgTable("app_config", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type AppConfig = typeof appConfigTable.$inferSelect;
