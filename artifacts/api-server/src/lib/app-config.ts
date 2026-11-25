import { eq } from "drizzle-orm";
import { db, appConfigTable } from "@workspace/db";

/**
 * Get a config value — env var takes priority, then DB-stored credential.
 */
export async function getConfig(key: string): Promise<string | undefined> {
  if (process.env[key]) return process.env[key];
  const [row] = await db
    .select({ value: appConfigTable.value })
    .from(appConfigTable)
    .where(eq(appConfigTable.key, key))
    .limit(1);
  return row?.value;
}
