import { describe, expect, it } from "vitest";
import { isInRollout, resolveUpdate, rolloutBucket, type UpdateCandidate } from "../src/protocol/resolve";

const update = (id: string, createdAt: string, extra: Partial<UpdateCandidate> = {}): UpdateCandidate => ({
  id,
  createdAt,
  rolloutPct: 100,
  status: "active",
  rolledBackAt: null,
  ...extra,
});

const device = { clientId: "client-1", currentUpdateId: "embedded", embeddedUpdateId: "embedded" };

describe("resolveUpdate", () => {
  it("serves the newest active update", async () => {
    const r = await resolveUpdate([update("a", "2026-01-01"), update("b", "2026-02-01")], device);
    expect(r).toEqual({ type: "update", updateId: "b" });
  });

  it("returns noUpdateAvailable when the device already runs it (case-insensitive)", async () => {
    const r = await resolveUpdate([update("abc", "2026-01-01")], { ...device, currentUpdateId: "ABC" });
    expect(r).toEqual({ type: "noUpdateAvailable" });
  });

  it("returns noUpdateAvailable when nothing was ever published", async () => {
    expect(await resolveUpdate([], device)).toEqual({ type: "noUpdateAvailable" });
  });

  it("skips rolled-back updates and falls back to the previous active one", async () => {
    const r = await resolveUpdate(
      [update("a", "2026-01-01"), update("b", "2026-02-01", { status: "rolled_back", rolledBackAt: "2026-02-02" })],
      { ...device, currentUpdateId: "b" },
    );
    expect(r).toEqual({ type: "update", updateId: "a" });
  });

  it("rolls back to embedded once every update is rolled back", async () => {
    const r = await resolveUpdate(
      [
        update("a", "2026-01-01", { status: "rolled_back", rolledBackAt: "2026-02-03" }),
        update("b", "2026-02-01", { status: "rolled_back", rolledBackAt: "2026-02-02" }),
      ],
      { ...device, currentUpdateId: "b" },
    );
    expect(r).toEqual({ type: "rollBackToEmbedded", commitTime: "2026-02-03" });
  });

  it("does not send a rollback directive to a device already on its embedded bundle", async () => {
    const r = await resolveUpdate(
      [update("b", "2026-02-01", { status: "rolled_back", rolledBackAt: "2026-02-02" })],
      device,
    );
    expect(r).toEqual({ type: "noUpdateAvailable" });
  });

  it("devices outside a partial rollout fall through to the previous update", async () => {
    const partial = update("new", "2026-03-01", { rolloutPct: 0 });
    const r = await resolveUpdate([update("old", "2026-01-01"), partial], device);
    expect(r).toEqual({ type: "update", updateId: "old" });
  });

  it("devices without a client id are never in a partial rollout", async () => {
    const r = await resolveUpdate([update("new", "2026-03-01", { rolloutPct: 99 })], { ...device, clientId: null });
    expect(r).toEqual({ type: "noUpdateAvailable" });
  });
});

describe("rollout bucketing", () => {
  it("is deterministic", async () => {
    expect(await rolloutBucket("c", "u")).toBe(await rolloutBucket("c", "u"));
  });

  it.each([10, 50, 90])("puts about %i%% of devices in the rollout", async (pct) => {
    const n = 5000;
    let included = 0;
    for (let i = 0; i < n; i++) {
      if (await isInRollout(crypto.randomUUID(), "update-1", pct)) included++;
    }
    expect(Math.abs(included / n - pct / 100)).toBeLessThan(0.03);
  });

  it("buckets are spread evenly across 0–99", async () => {
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 10000; i++) counts[Math.floor((await rolloutBucket(crypto.randomUUID(), "u")) / 10)]++;
    for (const c of counts) expect(c).toBeGreaterThan(850);
  });

  it("widening a rollout keeps devices that were already in", async () => {
    for (let i = 0; i < 500; i++) {
      const id = crypto.randomUUID();
      if (await isInRollout(id, "u", 20)) expect(await isInRollout(id, "u", 60)).toBe(true);
    }
  });
});
