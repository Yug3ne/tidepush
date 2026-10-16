import { adminRequest } from "../server/admin";

/**
 * The admin API as the web app uses it: every call goes through one server
 * function (server/admin.ts), as the signed-in person. A client is scoped to an
 * org and, for app pages, an app, taken from the route, never from global
 * state, so concurrent server renders can't mix them up.
 */

export type Role = "owner" | "admin" | "member";

export interface Admin {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

const request = <T>(path: string, method: Method = "GET", json?: unknown) =>
  adminRequest({ data: { method, path, json } }) as Promise<T>;

export interface Update {
  id: string;
  groupId: string;
  channel: string;
  platform: "ios" | "android";
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
  platform: string;
  runtime_version: string;
  update_count: number;
  last_published_at: string;
}

export interface Stats {
  days: number;
  totals: { platform: string; devices: number }[];
  byRuntime: { platform: string; runtime_version: string; channel: string; devices: number; last_seen: string }[];
  byUpdate: {
    update_id: string | null;
    platform: string;
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
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface RollbackResult {
  results: { id: string; platform: string; outcome: "embedded" | "republished" | "rolled_back"; republishedId?: string }[];
}

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

export interface OrgSummary {
  id: string;
  slug: string;
  name: string;
  role: Role;
}

export interface UsageReport {
  plan: "selfhost" | "subscribed" | "free";
  subscribed: boolean;
  limits: { monthlyActiveDevices: number; apps: number; members: number } | null;
  usage: { month: string; monthlyActiveDevices: number; apps: number; members: number };
  over: ("monthlyActiveDevices" | "apps" | "members")[];
  overLimitSince: string | null;
  publishingPausedFrom: string | null;
  publishingPaused: boolean;
}

const q = (params: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : "";
};

const enc = encodeURIComponent;

/** Calls that don't belong to one org. */
export const accountApi = {
  me: () => request<{ admin: Admin | null; orgs?: OrgSummary[] }>("/me"),
  createOrg: (name: string) => request<OrgSummary>("/orgs", "POST", { name }),
  acceptInvite: (token: string) =>
    request<{ orgId: string; orgName: string; role: Role }>(`/invites/${enc(token)}/accept`, "POST"),
};

export function createAdminApi(scope: { orgId: string; appId?: string }) {
  const org = `/orgs/${enc(scope.orgId)}`;
  const app = () => {
    if (!scope.appId) throw new Error("No app selected");
    return `/apps/${enc(scope.appId)}`;
  };
  return {
    // ---- App ----
    updates: (filter: { channel?: string; platform?: string; runtimeVersion?: string; limit?: number }) =>
      request<{ updates: Update[] }>(`${app()}/updates${q(filter)}`),
    channels: () => request<{ channels: ChannelRow[] }>(`${app()}/channels`),
    promote: (id: string, body: { channel: string; rolloutPct?: number; message?: string }) =>
      request<{ groupId: string; channel: string }>(`${app()}/updates/${enc(id)}/promote`, "POST", body),
    rollout: (id: string, pct: number) => request<unknown>(`${app()}/updates/${enc(id)}/rollout`, "POST", { pct }),
    rollback: (id: string, toEmbedded: boolean) =>
      request<RollbackResult>(`${app()}/updates/${enc(id)}/rollback`, "POST", { toEmbedded }),
    stats: (days: number) => request<Stats>(`${app()}/stats${q({ days })}`),
    appAudit: () => request<{ entries: AuditEntry[] }>(`${app()}/audit`),
    keys: () =>
      request<{ keys: SigningKey[]; environmentKey: { keyId: string; source: "environment" } | null }>(`${app()}/keys`),
    /** Same-origin download link (served by routes/api/certificate). */
    certificateUrl: (keyId: string) => `/api/certificate/${enc(scope.appId ?? "")}/${enc(keyId)}`,
    createKey: (keyId: string) =>
      request<{ keyId: string; certificatePem: string; fingerprint: string }>(`${app()}/keys`, "POST", { keyId }),
    uploadKey: (body: { keyId: string; privateKeyPem: string; certificatePem: string }) =>
      request<{ keyId: string; fingerprint: string }>(`${app()}/keys/upload`, "POST", body),
    exportKey: (keyId: string, password: string) =>
      request<{ keyId: string; privateKeyPem: string }>(`${app()}/keys/${enc(keyId)}/export`, "POST", { password }),
    retireKey: (keyId: string) => request<void>(`${app()}/keys/${enc(keyId)}/retire`, "POST"),

    // ---- Org ----
    apps: () => request<{ apps: AppInfo[] }>(`${org}/apps`),
    createApp: (name: string) =>
      request<AppInfo & { signingKey: { keyId: string; certificatePem: string } | null }>(`${org}/apps`, "POST", { name }),
    updateApp: (appId: string, body: { name?: string; archived?: boolean }) =>
      request<AppInfo>(`${org}/apps/${enc(appId)}`, "PATCH", body),
    audit: () => request<{ entries: AuditEntry[] }>(`${org}/audit`),
    usage: () => request<UsageReport>(`${org}/usage`),
    team: () => request<{ admins: TeamAdmin[]; invites: PendingInvite[] }>(`${org}/members`),
    invite: (email: string, role: Role) =>
      request<{ inviteUrl: string; token: string; expiresAt: string; emailed: boolean }>(`${org}/members/invites`, "POST", {
        email,
        role,
      }),
    revokeInvite: (email: string) => request<void>(`${org}/members/invites/${enc(email)}`, "DELETE"),
    removeAdmin: (id: string) => request<void>(`${org}/members/${enc(id)}`, "DELETE"),
    changeRole: (id: string, role: Role) => request<{ id: string; role: Role }>(`${org}/members/${enc(id)}`, "PATCH", { role }),
    tokens: () => request<{ tokens: (ApiToken & { appId: string | null })[] }>(`${org}/tokens`),
    createToken: (name: string, appId?: string) =>
      request<{ token: string; id: string; name: string; prefix: string }>(`${org}/tokens`, "POST", { name, appId }),
    revokeToken: (id: string) => request<void>(`${org}/tokens/${enc(id)}`, "DELETE"),
  };
}

export type AdminApi = ReturnType<typeof createAdminApi>;
