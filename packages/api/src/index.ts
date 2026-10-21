/**
 * The admin API's JSON shapes, shared by the API Worker (apps/server), the web
 * app (apps/web) and the CLI (packages/cli). Types only: nothing here ends up
 * in a bundle.
 */

export type Role = "owner" | "admin" | "member";

export type Platform = "ios" | "android";

export type PlanName = "selfhost" | "subscribed" | "free";

/** A person who can sign in. `role` is their role in the org the request is about (or their only org). */
export interface Admin {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface OrgSummary {
  id: string;
  slug: string;
  name: string;
  role: Role;
}

// ---- Updates ----------------------------------------------------------------

export interface Update {
  id: string;
  groupId: string;
  channel: string;
  platform: Platform;
  runtimeVersion: string;
  createdAt: string;
  message: string | null;
  gitSha: string | null;
  rolloutPct: number;
  status: "active" | "rolled_back";
  rolledBackAt: string | null;
  sourceUpdateId: string | null;
  createdBy: string | null;
  assetCount?: number;
  deviceCount?: number;
}

export interface ChannelRow {
  channel: string;
  platform: Platform;
  runtime_version: string;
  update_count: number;
  last_published_at: string;
}

export interface PublishResult {
  groupId: string;
  channel: string;
  createdAt: string;
  updates: { id: string; platform: Platform; runtimeVersion: string }[];
}

export interface PromoteResult {
  groupId: string;
  channel: string;
  updates: { id: string; platform: Platform; sourceId: string }[];
}

export interface RolloutResult {
  updates: { id: string; platform: Platform; rolloutPct: number }[];
}

export interface RollbackResult {
  results: {
    id: string;
    platform: Platform;
    outcome: "embedded" | "republished" | "rolled_back";
    republishedId?: string;
  }[];
}

export interface Stats {
  days: number;
  totals: { platform: Platform; devices: number }[];
  byRuntime: { platform: Platform; runtime_version: string; channel: string; devices: number; last_seen: string }[];
  byUpdate: {
    update_id: string | null;
    platform: Platform;
    channel: string;
    runtime_version: string;
    devices: number;
    is_embedded: number | null;
    message: string | null;
    created_at: string | null;
    status: string | null;
    rollout_pct: number | null;
  }[];
}

export interface AuditEntry {
  id: number;
  at: string;
  actor: string;
  action: string;
  target: string | null;
  details_json: string | null;
}

// ---- Apps and signing keys --------------------------------------------------

export interface AppInfo {
  id: string;
  name: string;
  createdAt: string;
  archived: boolean;
}

export interface SigningKey {
  keyId: string;
  source: "generated" | "uploaded";
  createdAt: string;
  retired: boolean;
  retiredAt: string | null;
  certificatePem: string;
  fingerprint: string;
}

// ---- Team and tokens --------------------------------------------------------

export interface TeamAdmin extends Admin {
  createdAt: string;
  lastLoginAt: string | null;
  disabled: boolean;
}

export interface PendingInvite {
  email: string;
  role: Role;
  createdAt: string;
  expiresAt: string;
}

export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  /** Set when the token is restricted to one app. */
  appId: string | null;
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
}

// ---- Billing ----------------------------------------------------------------

export interface PlanLimits {
  monthlyActiveDevices: number;
  apps: number;
  members: number;
}

export interface UsageReport {
  plan: PlanName;
  subscribed: boolean;
  /** Null when there are no limits. */
  limits: PlanLimits | null;
  usage: { month: string; monthlyActiveDevices: number; apps: number; members: number };
  /** Limits currently exceeded. */
  over: (keyof PlanLimits)[];
  overLimitSince: string | null;
  /** When publishing pauses (or paused), if the org stays over its limits. */
  publishingPausedFrom: string | null;
  publishingPaused: boolean;
}
