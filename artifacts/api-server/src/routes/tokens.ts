import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, apiTokensTable, channelsTable } from "@workspace/db";
import { CreateTokenBody, DeleteTokenParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/tokens", async (_req, res): Promise<void> => {
  const tokens = await db.select({
    id: apiTokensTable.id,
    platform: apiTokensTable.platform,
    label: apiTokensTable.label,
    isActive: apiTokensTable.isActive,
    createdAt: apiTokensTable.createdAt,
  }).from(apiTokensTable);

  res.json(tokens);
});

router.post("/tokens", async (req, res): Promise<void> => {
  const parsed = CreateTokenBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [token] = await db
    .insert(apiTokensTable)
    .values({
      platform: parsed.data.platform,
      accessToken: parsed.data.accessToken,
      refreshToken: parsed.data.refreshToken ?? null,
      label: parsed.data.label ?? null,
      isActive: true,
    })
    .returning();

  res.status(201).json({
    id: token.id,
    platform: token.platform,
    label: token.label,
    isActive: token.isActive,
    createdAt: token.createdAt,
  });
});

router.delete("/tokens/:id", async (req, res): Promise<void> => {
  const params = DeleteTokenParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid token ID" });
    return;
  }

  await db.delete(apiTokensTable).where(eq(apiTokensTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
