import type { EnvVarInfo, ResolvedEnv } from "@tidepush/api";
import { Hono, type Context } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import {
  ALL_CHANNELS,
  ENV_VAR_NAME,
  MAX_ENV_VALUE_LENGTH,
  MAX_ENV_VARS,
  decryptEnvValue,
  encryptEnvValue,
  requireEnvVarKey,
} from "../appenv";
import { auditStatement } from "../db";
import type { AppEnv } from "../env";
import { HttpError, channelSchema, parseBody } from "../lib/http";

/**
 * An app's build-time variables: /admin/apps/:appId/env.
 *
 *   GET    /            names only, for anyone in the org. Values are never listed.
 *   PUT    /            set values. A signed-in admin or owner, never a token.
 *   DELETE /:name       remove one. Same.
 *   POST   /resolve     the values for one channel, for `tidepush publish`:
 *                       whoever can publish (admins, owners, API tokens).
 *
 * Tokens can't write, so a leaked CI token can't quietly change what every
 * later publish bundles. Every read of the values and every change is in the
 * audit log, without the values.
 */
const appEnv = new Hono<AppEnv>();

const audit = (c: Context<AppEnv>, entry: { action: string; target?: string; details?: unknown }) =>
  auditStatement(c.env.DB, { ...entry, actor: c.get("actor"), orgId: c.get("orgId"), appId: c.get("app").id });

/** Changes come from a person. The scope middleware has already required admin or owner. */
const requireSignedIn = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("admin")) {
    throw new HttpError(
      403,
      "API tokens can't change environment variables. Sign in (`npx tidepush login`, or the dashboard) as an admin or owner.",
    );
  }
  await next();
});

const nameSchema = z
  .string()
  .regex(ENV_VAR_NAME, "names must start with EXPO_PUBLIC_ (letters, digits and _ after it)");
const valueSchema = z
  .string()
  .min(1, "a value can't be empty; remove the variable instead")
  .max(MAX_ENV_VALUE_LENGTH, `a value can be at most ${MAX_ENV_VALUE_LENGTH} characters`)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this rejects.
  .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), "a value can't contain line breaks or control characters");
/** null or missing = every channel. */
const scopeSchema = channelSchema.nullish().transform((c) => c ?? ALL_CHANNELS);

const label = (channel: string) => (channel === ALL_CHANNELS ? "all channels" : channel);

appEnv.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT name, channel, updated_at, updated_by FROM app_env_vars WHERE app_id = ? ORDER BY channel, name`,
  )
    .bind(c.get("app").id)
    .all<{ name: string; channel: string; updated_at: string; updated_by: string }>();
  const vars: EnvVarInfo[] = results.map((r) => ({
    name: r.name,
    channel: r.channel === ALL_CHANNELS ? null : r.channel,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  }));
  return c.json({ vars });
});

appEnv.put("/", requireSignedIn, async (c) => {
  const body = await parseBody(
    c,
    z.object({
      channel: scopeSchema,
      vars: z
        .record(nameSchema, valueSchema)
        .refine((v) => Object.keys(v).length > 0, "give at least one variable")
        .refine((v) => Object.keys(v).length <= MAX_ENV_VARS, `at most ${MAX_ENV_VARS} variables`),
    }),
  );
  const db = c.env.DB;
  const appId = c.get("app").id;
  const channel = body.channel;
  const names = Object.keys(body.vars);
  const key = await requireEnvVarKey(c.env);

  const { results: existing } = await db
    .prepare(`SELECT name FROM app_env_vars WHERE app_id = ? AND channel = ?`)
    .bind(appId, channel)
    .all<{ name: string }>();
  const total = new Set([...existing.map((r) => r.name), ...names]).size;
  if (total > MAX_ENV_VARS) {
    throw new HttpError(400, `At most ${MAX_ENV_VARS} variables for ${label(channel)}; this would make ${total}.`);
  }

  const now = new Date().toISOString();
  const statements = await Promise.all(
    names.map(async (name) =>
      db
        .prepare(
          `INSERT INTO app_env_vars (app_id, channel, name, value_enc, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (app_id, channel, name) DO UPDATE SET
             value_enc = excluded.value_enc, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
        )
        .bind(
          appId,
          channel,
          name,
          await encryptEnvValue(key, body.vars[name]!, { appId, channel, name }),
          c.get("actor"),
          now,
        ),
    ),
  );
  await db.batch([...statements, audit(c, { action: "env_set", target: label(channel), details: { names } })]);
  return c.json({ channel: channel === ALL_CHANNELS ? null : channel, names });
});

appEnv.delete("/:name", requireSignedIn, async (c) => {
  const name = c.req.param("name");
  const parsed = scopeSchema.safeParse(c.req.query("channel"));
  if (!ENV_VAR_NAME.test(name) || !parsed.success) throw new HttpError(404, "No such variable");
  const channel = parsed.data;
  const removed = await c.env.DB.prepare(`DELETE FROM app_env_vars WHERE app_id = ? AND channel = ? AND name = ?`)
    .bind(c.get("app").id, channel, name)
    .run();
  if (!removed.meta.changes) throw new HttpError(404, `No variable ${name} for ${label(channel)}`);
  await audit(c, { action: "env_delete", target: label(channel), details: { names: [name] } }).run();
  return c.body(null, 204);
});

/**
 * The values `tidepush publish` passes to `expo export` for a channel: those
 * set for every channel, then the channel's own on top. POST, so the read-only
 * role is refused by the scope middleware and nothing sensitive is in a URL.
 */
appEnv.post("/resolve", async (c) => {
  const { channel } = await parseBody(c, z.object({ channel: channelSchema }));
  const appId = c.get("app").id;
  const { results } = await c.env.DB.prepare(
    // The channel's own rows come last, so they overwrite the shared ones below.
    `SELECT name, channel, value_enc FROM app_env_vars WHERE app_id = ?1 AND channel IN ('', ?2)
     ORDER BY channel = ?2, name`,
  )
    .bind(appId, channel)
    .all<{ name: string; channel: string; value_enc: string }>();

  const vars: Record<string, string> = {};
  if (results.length) {
    const key = await requireEnvVarKey(c.env);
    for (const r of results) {
      vars[r.name] = await decryptEnvValue(key, r.value_enc, { appId, channel: r.channel, name: r.name });
    }
    await audit(c, { action: "env_read", target: channel, details: { count: Object.keys(vars).length } }).run();
  }
  return c.json({ channel, vars } satisfies ResolvedEnv);
});

export default appEnv;
