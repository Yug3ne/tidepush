import { afterAll, describe, expect, it } from "bun:test";
import { ApiError } from "./api";
import { importable, parseAssignments, resolveServerEnv } from "./envvars";
import { childEnv } from "./publish";

describe("parseAssignments", () => {
  it("splits on the first =", () => {
    expect(parseAssignments(["EXPO_PUBLIC_A=1", "EXPO_PUBLIC_URL=https://x.test/?a=b"])).toEqual({
      EXPO_PUBLIC_A: "1",
      EXPO_PUBLIC_URL: "https://x.test/?a=b",
    });
    expect(() => parseAssignments(["EXPO_PUBLIC_A"])).toThrow("NAME=value");
    expect(() => parseAssignments(["=x"])).toThrow("NAME=value");
  });
});

describe("importable", () => {
  it("keeps EXPO_PUBLIC_* entries that have a value", () => {
    expect(
      importable({ EXPO_PUBLIC_A: "1", EXPO_PUBLIC_EMPTY: "", TIDEPUSH_TOKEN: "tp_x", NODE_OPTIONS: "--require x" }),
    ).toEqual({ vars: { EXPO_PUBLIC_A: "1" }, skipped: ["EXPO_PUBLIC_EMPTY", "TIDEPUSH_TOKEN", "NODE_OPTIONS"] });
  });
});

describe("childEnv with server variables", () => {
  it("lets the server's values win over the shell's, but never over what the CLI sets", () => {
    const env = childEnv(
      "staging",
      { PATH: "/bin", EXPO_PUBLIC_A: "from-shell" },
      { EXPO_PUBLIC_A: "from-server", TIDEPUSH_CHANNEL: "other", CI: "0" },
    );
    expect(env).toEqual({ PATH: "/bin", EXPO_PUBLIC_A: "from-server", TIDEPUSH_CHANNEL: "staging", CI: "1" });
  });
});

describe("resolveServerEnv", () => {
  const seen: { path: string; body: string }[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      seen.push({ path, body: await req.text() });
      if (path.startsWith("/admin/apps/app_old/")) return Response.json({ error: "Not found" }, { status: 404 });
      if (path.startsWith("/admin/apps/app_gone/")) return Response.json({ error: "App not found" }, { status: 404 });
      if (path.startsWith("/admin/apps/app_readonly/")) return Response.json({ error: "read-only" }, { status: 403 });
      if (path.startsWith("/admin/apps/app_broken/"))
        return Response.json({ error: "Internal error" }, { status: 500 });
      return Response.json({
        channel: "production",
        vars: { EXPO_PUBLIC_API_URL: "https://api.test", PATH: "/evil", NODE_OPTIONS: "--require /evil.js" },
      });
    },
  });
  afterAll(() => server.stop(true));
  const cfg = (appId: string) => ({ server: `http://localhost:${server.port}`, token: "tp_token", appId });

  it("asks for the channel and passes on only EXPO_PUBLIC_* names", async () => {
    expect(await resolveServerEnv(cfg("app_one"), "production")).toEqual({ EXPO_PUBLIC_API_URL: "https://api.test" });
    expect(seen.at(-1)).toEqual({
      path: "/admin/apps/app_one/env/resolve",
      body: JSON.stringify({ channel: "production" }),
    });
  });

  it("treats a server from before this feature as having none", async () => {
    expect(await resolveServerEnv(cfg("app_old"), "production")).toEqual({});
  });

  it("fails, rather than publish without them, on any other error", async () => {
    for (const [app, status] of [
      ["app_gone", 404],
      ["app_readonly", 403],
      ["app_broken", 500],
    ] as const) {
      const err = (await resolveServerEnv(cfg(app), "production").catch((e: ApiError) => e)) as ApiError;
      expect(err).toBeInstanceOf(ApiError);
      expect(err.status).toBe(status);
    }
  });
});
