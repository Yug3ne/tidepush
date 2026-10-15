import { Hono } from "hono";
import { z } from "zod";
import { requireHuman } from "../auth/middleware";
import { generateApiToken, type ApiTokenRow } from "../auth/tokens";
import { auditStatement } from "../db";
import type { AppEnv } from "../env";
import { HttpError, parseBody } from "../lib/http";

/**
 * /admin/tokens: API tokens for the CLI / CI. Managed by a signed-in admin (an
 * API token can't mint or revoke tokens). The plaintext is returned once.
 */
const tokens = new Hono<AppEnv>();
tokens.use("*", requireHuman);

tokens.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM api_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC`,
  ).all<ApiTokenRow>();
  return c.json({
    tokens: results.map((t) => ({
      id: t.id,
      name: t.name,
      prefix: t.prefix,
      createdBy: t.created_by,
      createdAt: t.created_at,
      lastUsedAt: t.last_used_at,
    })),
  });
});

tokens.post("/", async (c) => {
  const db = c.env.DB;
  const { name } = await parseBody(c, z.object({ name: z.string().trim().min(1, "name is required").max(100) }));
  const { token, hash, prefix } = await generateApiToken();
  const id = crypto.randomUUID();
  const actor = c.get("actor");
  await db.batch([
    db
      .prepare(`INSERT INTO api_tokens (id, name, token_hash, prefix, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(id, name, hash, prefix, actor, new Date().toISOString()),
    auditStatement(db, { actor, action: "token_create", target: id, details: { name, prefix } }),
  ]);
  return c.json({ token, id, name, prefix }, 201);
});

tokens.delete("/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const revoked = await db
    .prepare(`UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`)
    .bind(new Date().toISOString(), id)
    .run();
  if (!revoked.meta.changes) throw new HttpError(404, "Token not found");
  await auditStatement(db, { actor: c.get("actor"), action: "token_revoke", target: id }).run();
  return c.body(null, 204);
});

export default tokens;
