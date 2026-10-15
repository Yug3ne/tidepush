import { Hono } from "hono";
import type { AppEnv } from "../env";

export const ASSET_KEY = /^[0-9a-f]{64}$/;

export const r2KeyFor = (key: string) => `assets/${key}`;

const assets = new Hono<AppEnv>();

// Assets are content-addressed (key = sha256), so they never change and can be cached forever.
assets.get("/:key", async (c) => {
  const key = c.req.param("key");
  if (!ASSET_KEY.test(key)) return c.notFound();

  const cache = caches.default;
  const cached = await cache.match(c.req.raw);
  if (cached) return cached;

  const object = await c.env.BUCKET.get(r2KeyFor(key));
  if (!object) return c.notFound();

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  const response = new Response(object.body, { headers });
  c.executionCtx.waitUntil(cache.put(c.req.raw, response.clone()));
  return response;
});

export default assets;
