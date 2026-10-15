import type { Context } from "hono";
import { z } from "zod";

export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 410 | 413 | 429 | 500 | 503;

export class HttpError extends Error {
  constructor(
    readonly status: ErrorStatus,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export async function parseBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const json = await c.req.json().catch(() => {
    throw new HttpError(400, "Body must be JSON");
  });
  const result = schema.safeParse(json);
  if (!result.success) throw new HttpError(400, z.prettifyError(result.error));
  return result.data;
}

/** Origin of the request URL, e.g. "https://ota.example.com". */
export const requestOrigin = (c: Context) => new URL(c.req.url).origin;

/** True if the browser's Origin header names this deployment (CSRF check). */
export const isSameOrigin = (c: Context) => c.req.header("origin") === requestOrigin(c);

export const isMutating = (method: string) => !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());

// Shared input rules for accounts.
export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email("invalid email"));
export const nameSchema = z.string().trim().min(1, "name is required").max(100);
export const passwordSchema = z
  .string()
  .min(12, "password must be at least 12 characters")
  .max(256, "password must be at most 256 characters");
export const roleSchema = z.enum(["owner", "admin", "member"]);
