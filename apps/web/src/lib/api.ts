import type {
  Admin,
  ApiToken,
  AppInfo,
  AuditEntry,
  ChannelRow,
  OrgSummary,
  PendingInvite,
  PromoteResult,
  Role,
  RollbackResult,
  RolloutResult,
  SigningKey,
  Stats,
  TeamAdmin,
  Update,
  UsageReport,
} from "@tidepush/api";
import { adminRequest } from "../server/admin";

/**
 * The admin API as the web app uses it: every call goes through one server
 * function (server/admin.ts), as the signed-in person. A client is scoped to an
 * org and, for app pages, an app, taken from the route, never from global
 * state, so concurrent server renders can't mix them up.
 */

// The response shapes live in @tidepush/api, shared with the API Worker and the CLI.
export type {
  Admin,
  ApiToken,
  AppInfo,
  AuditEntry,
  ChannelRow,
  OrgSummary,
  PendingInvite,
  Role,
  RollbackResult,
  SigningKey,
  Stats,
  TeamAdmin,
  Update,
  UsageReport,
};

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

const request = <T>(path: string, method: Method = "GET", json?: unknown) =>
  adminRequest({ data: { method, path, json } }) as Promise<T>;

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
      request<PromoteResult>(`${app()}/updates/${enc(id)}/promote`, "POST", body),
    rollout: (id: string, pct: number) => request<RolloutResult>(`${app()}/updates/${enc(id)}/rollout`, "POST", { pct }),
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
    tokens: () => request<{ tokens: ApiToken[] }>(`${org}/tokens`),
    createToken: (name: string, appId?: string) =>
      request<{ token: string; id: string; name: string; prefix: string }>(`${org}/tokens`, "POST", { name, appId }),
    revokeToken: (id: string) => request<void>(`${org}/tokens/${enc(id)}`, "DELETE"),
  };
}

export type AdminApi = ReturnType<typeof createAdminApi>;
