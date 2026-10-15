import { afterAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { api, ApiError, apiConfigFromEnv } from "./api";
import { childEnv, retry } from "./publish";

describe("apiConfigFromEnv", () => {
  it("reads TIDEPUSH_* variables", () => {
    const cfg = apiConfigFromEnv(
      {},
      {
        TIDEPUSH_SERVER_URL: "https://ota.example.com/",
        TIDEPUSH_API_TOKEN: "tp_abc",
        TIDEPUSH_ACCESS_CLIENT_ID: "id",
        TIDEPUSH_ACCESS_CLIENT_SECRET: "secret",
      },
    );
    expect(cfg).toEqual({
      server: "https://ota.example.com",
      token: "tp_abc",
      accessClientId: "id",
      accessClientSecret: "secret",
    });
  });

  it("prefers --server and ignores the old OTA_* names", () => {
    expect(apiConfigFromEnv({ server: "http://localhost:8787" }, { TIDEPUSH_API_TOKEN: "tp_x" }).server).toBe(
      "http://localhost:8787",
    );
    expect(() => apiConfigFromEnv({}, { OTA_SERVER_URL: "https://x", OTA_API_TOKEN: "t" })).toThrow("TIDEPUSH_SERVER_URL");
    expect(() => apiConfigFromEnv({}, { TIDEPUSH_SERVER_URL: "https://x" })).toThrow("TIDEPUSH_API_TOKEN");
  });
});

describe("childEnv", () => {
  it("sets TIDEPUSH_CHANNEL (not OTA_CHANNEL) for expo commands", () => {
    const env = childEnv("staging", { PATH: "/bin" });
    expect(env).toEqual({ PATH: "/bin", TIDEPUSH_CHANNEL: "staging", CI: "1" });
    expect(env.OTA_CHANNEL).toBeUndefined();
  });
});

describe("api", () => {
  const seen: { req: Request; body: string }[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      seen.push({ req, body: await req.text() });
      const path = new URL(req.url).pathname;
      if (path === "/admin/fail") return Response.json({ error: "nope" }, { status: 403 });
      return Response.json({ ok: true });
    },
  });
  afterAll(() => server.stop(true));
  const base = { server: `http://localhost:${server.port}`, token: "tp_token" };

  it("sends the bearer token, Access headers and JSON to /admin", async () => {
    const res = await api<{ ok: boolean }>(
      { ...base, accessClientId: "cid", accessClientSecret: "csecret" },
      "/updates",
      { method: "POST", json: { a: 1 } },
    );
    expect(res).toEqual({ ok: true });
    const { req, body } = seen.at(-1)!;
    expect(new URL(req.url).pathname).toBe("/admin/updates");
    expect(req.headers.get("authorization")).toBe("Bearer tp_token");
    expect(req.headers.get("cf-access-client-id")).toBe("cid");
    expect(req.headers.get("cf-access-client-secret")).toBe("csecret");
    expect(JSON.parse(body)).toEqual({ a: 1 });
  });

  it("surfaces the server's error message and status", async () => {
    const err = (await api(base, "/fail").catch((e: ApiError) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    expect(err.message).toContain("nope");
  });
});

describe("retry", () => {
  it("retries 5xx and network errors, then succeeds", async () => {
    let calls = 0;
    const result = await retry(
      async () => {
        calls++;
        if (calls === 1) throw new ApiError(502, "bad gateway");
        if (calls === 2) throw new TypeError("fetch failed");
        return "ok";
      },
      4,
      1,
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("fails immediately on 4xx", async () => {
    let calls = 0;
    const err = await retry(
      async () => {
        calls++;
        throw new ApiError(401, "Unauthorized");
      },
      4,
      1,
    ).catch((e: ApiError) => e);
    expect(err.status).toBe(401);
    expect(calls).toBe(1);
  });

  it("gives up after the last attempt", async () => {
    let calls = 0;
    await expect(
      retry(
        async () => {
          calls++;
          throw new ApiError(500, "boom");
        },
        3,
        1,
      ),
    ).rejects.toThrow("boom");
    expect(calls).toBe(3);
  });
});

describe("tidepush help", () => {
  it("documents the tidepush binary and TIDEPUSH_* env", async () => {
    const proc = Bun.spawn(["bun", join(import.meta.dir, "index.ts"), "help"], { stdout: "pipe" });
    const out = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    expect(out).toContain("tidepush publish");
    expect(out).toContain("TIDEPUSH_API_TOKEN");
    expect(out).toContain("TIDEPUSH_CHANNEL");
    expect(out).not.toContain("OTA_");
  });

  it("exits non-zero with a hint for unknown commands", async () => {
    const proc = Bun.spawn(["bun", join(import.meta.dir, "index.ts"), "frobnicate"], { stderr: "pipe" });
    const err = await new Response(proc.stderr).text();
    expect(await proc.exited).toBe(1);
    expect(err).toContain("tidepush help");
  });
});
