import { Hono } from "hono";
import { apiSecurityHeaders, withDashboardHeaders } from "./auth/middleware";
import type { AppEnv } from "./env";
import { HttpError } from "./lib/http";
import { handleManifest } from "./protocol/manifest";
import admin from "./routes/admin";
import assets from "./routes/assets";
import auth from "./routes/auth";

const app = new Hono<AppEnv>();

app.get("/health", (c) => c.json({ ok: true }));
app.get("/manifest", handleManifest);
app.route("/assets", assets);
app.use("/auth/*", apiSecurityHeaders);
app.use("/admin/*", apiSecurityHeaders);
app.route("/auth", auth);
app.route("/admin", admin);

// Paths the Worker owns answer with JSON 404s. Everything else is the dashboard
// SPA (static assets), served with security headers and a CSP.
const API_PATH = /^\/(admin|auth|assets|manifest|health)(\/|$)/;
app.notFound(async (c) => {
  if (API_PATH.test(c.req.path)) return c.json({ error: "Not found" }, 404);
  return withDashboardHeaders(await c.env.ASSETS.fetch(c.req.raw));
});

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status, err.headers);
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});

export default app;
