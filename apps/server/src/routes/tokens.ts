import type { ApiToken } from "@tidepush/api";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { requireHuman, requireWriteAccess } from "../auth/middleware";
import { generateApiToken, type ApiTokenRow } from "../auth/tokens";
import { auditStatement } from "../db";
import type { AppEnv } from "../env";
import { HttpError, parseBody } from "../lib/http";
import { APP_ID } from "../tenancy";

/**
 * An org's API tokens for the CLI / CI. Managed by a signed-in admin or owner
 * (an API token can't mint or revoke tokens). The plaintext is returned once.
 * Mounted at /admin/orgs/:orgId/tokens and (for single-org callers) /admin/tokens.
 */
const tokens = new Hono<AppEnv>();
tokens.use("*", requireHuman, requireWriteAccess);

const audit = (c: Context<AppEnv>, entry: { action: string; target?: string; details?: unknown }) =>
  auditStatement(c.env.DB, { ...entry, actor: c.get("actor"), orgId: c.get("orgId") });

tokens.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM api_tokens WHERE org_id = ? AND revoked_at IS NULL ORDER BY created_at DESC`,
  )
    .bind(c.get("orgId"))
    .all<ApiTokenRow>();
  return c.json({
    tokens: results.map(
      (t): ApiToken => ({
        id: t.id,
        name: t.name,
        prefix: t.prefix,
        appId: t.app_id,
        createdBy: t.created_by,
        createdAt: t.created_at,
        lastUsedAt: t.last_used_at,
      }),
    ),
  });
});

tokens.post("/", async (c) => {
  const db = c.env.DB;
  const orgId = c.get("orgId");
  const { name, appId } = await parseBody(
    c,
    z.object({
      name: z.string().trim().min(1, "name is required").max(100),
      /** Restricts the token to one app. Omit for an org-wide token. */
      appId: z.string().regex(APP_ID, "invalid app id").optional(),
    }),
  );
  if (appId) {
    const app = await db.prepare(`SELECT 1 FROM apps WHERE id = ? AND org_id = ?`).bind(appId, orgId).first();
    if (!app) throw new HttpError(404, "App not found");
  }
  const { token, hash, prefix } = await generateApiToken();
  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `INSERT INTO api_tokens (id, org_id, app_id, name, token_hash, prefix, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, orgId, appId ?? null, name, hash, prefix, c.get("actor"), new Date().toISOString()),
    audit(c, { action: "token_create", target: id, details: { name, prefix, appId: appId ?? null } }),
  ]);
  return c.json({ token, id, name, prefix, appId: appId ?? null }, 201);
});

tokens.delete("/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const revoked = await db
    .prepare(`UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND org_id = ? AND revoked_at IS NULL`)
    .bind(new Date().toISOString(), id, c.get("orgId"))
    .run();
  if (!revoked.meta.changes) throw new HttpError(404, "Token not found");
  await audit(c, { action: "token_revoke", target: id }).run();
  return c.body(null, 204);
});

export default tokens;
