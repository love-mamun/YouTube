
import { defineConfig } from "drizzle-kit";
import path from "path";

const databaseUrl = process.env.DATABASE_URL;

console.log("[DB DEBUG]", {
  databaseUrlExists: Boolean(databaseUrl),
  nodeEnv: process.env.NODE_ENV,
});

if (!databaseUrl) {
  throw new Error("DATABASE_URL is missing");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
