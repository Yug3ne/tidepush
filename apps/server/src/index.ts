import { Hono } from "hono";
import { apiSecurityHeaders } from "./auth/middleware";
import type { AppEnv } from "./env";
import { internalEntrypoint } from "./internal";
import { HttpError } from "./lib/http";
import { handleAppManifest, handleLegacyManifest } from "./protocol/manifest";
import admin from "./routes/admin";
import { serveAppAsset, serveLegacyAsset } from "./routes/assets";
import auth from "./routes/auth";

const app = new Hono<AppEnv>();

app.get("/health", (c) => c.json({ ok: true }));
// Phones. Builds made before apps existed use the unprefixed paths, which serve the default app.
app.get("/:appId{app_[a-z0-9_]+}/manifest", handleAppManifest);
app.get("/:appId{app_[a-z0-9_]+}/assets/:key", serveAppAsset);
app.get("/manifest", handleLegacyManifest);
app.get("/assets/:key", serveLegacyAsset);
app.use("/auth/*", apiSecurityHeaders);
app.use("/admin/*", apiSecurityHeaders);
app.route("/auth", auth);
app.route("/admin", admin);

// The dashboard is the web app. People who open this server's address
// (an old bookmark of the built-in dashboard) are sent there.
app.get("/", (c) => (c.env.WEB_URL ? c.redirect(c.env.WEB_URL, 302) : c.json({ error: "Not found" }, 404)));

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status, err.headers);
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});

export default app;

/** For the web app's service binding (see internal.ts). */
export const Internal = internalEntrypoint(app);
