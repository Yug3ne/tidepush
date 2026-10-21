import { sha256 } from "../lib/encoding";

export interface UpdateCandidate {
  id: string;
  createdAt: string;
  rolloutPct: number;
  status: "active" | "rolled_back";
  rolledBackAt: string | null;
}

export type Resolution =
  | { type: "update"; updateId: string }
  | { type: "noUpdateAvailable" }
  | { type: "rollBackToEmbedded"; commitTime: string };

/** Stable 0–99 bucket for a device and update, so widening a rollout keeps earlier devices in. */
export async function rolloutBucket(clientId: string, updateId: string): Promise<number> {
  const digest = await sha256(`${clientId}:${updateId}`);
  const n = new DataView(digest.buffer, digest.byteOffset).getUint32(0);
  return n % 100;
}

export async function isInRollout(clientId: string | null, updateId: string, rolloutPct: number): Promise<boolean> {
  if (rolloutPct >= 100) return true;
  if (rolloutPct <= 0 || !clientId) return false;
  return (await rolloutBucket(clientId, updateId)) < rolloutPct;
}

/**
 * Picks what a device should run. `candidates` are every update for its
 * (channel, platform, runtime). The newest active update the device is
 * bucketed into wins; devices outside a partial rollout fall through to the
 * previous active update. If nothing is active but something was rolled back,
 * the device is sent back to its embedded bundle.
 */
export async function resolveUpdate(
  candidates: UpdateCandidate[],
  device: { clientId: string | null; currentUpdateId: string | null; embeddedUpdateId: string | null },
): Promise<Resolution> {
  const newestFirst = [...candidates].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  for (const u of newestFirst) {
    if (u.status !== "active") continue;
    if (!(await isInRollout(device.clientId, u.id, u.rolloutPct))) continue;
    if (u.id.toLowerCase() === device.currentUpdateId?.toLowerCase()) {
      return { type: "noUpdateAvailable" };
    }
    return { type: "update", updateId: u.id };
  }

  const rollbackTimes = newestFirst
    .filter((u) => u.status === "rolled_back" && u.rolledBackAt)
    .map((u) => u.rolledBackAt!)
    .sort();
  const lastRollback = rollbackTimes.at(-1);
  const runningEmbedded =
    !device.currentUpdateId || device.currentUpdateId.toLowerCase() === device.embeddedUpdateId?.toLowerCase();
  if (lastRollback && !runningEmbedded) {
    return { type: "rollBackToEmbedded", commitTime: lastRollback };
  }
  return { type: "noUpdateAvailable" };
}
