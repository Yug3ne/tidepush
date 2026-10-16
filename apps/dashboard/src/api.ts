// Thin JSON client for the Tidepush Worker. The dashboard authenticates with
// the HttpOnly session cookie only (same-origin), never with pasted tokens.

export type Role = "owner" | "admin" | "member";

export interface Admin {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Seconds, from the `retry-after` header (429). */
    readonly retryAfter: number | null = null,
  ) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;
/** Called when an /admin request answers 401 (session expired or revoked). */
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

type Method = "GET" | "POST" | "PUT" | "DELETE";

async function request<T>(path: string, method: Method = "GET", json?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (json !== undefined) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: json === undefined ? undefined : JSON.stringify(json),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && path.startsWith("/admin/")) onUnauthorized?.();
    const retry = Number(res.headers.get("retry-after"));
    const serverError = (data as { error?: unknown } | null)?.error;
    const message = typeof serverError === "string" && serverError ? serverError : defaultMessage(res.status);
    throw new ApiError(res.status, message, Number.isFinite(retry) && retry > 0 ? retry : null);
  }
  return data as T;
}

function defaultMessage(status: number) {
  if (status === 401) return "You're signed out. Sign in again.";
  if (status === 403) return "You don't have permission to do that.";
  if (status === 404) return "Not found.";
  if (status === 429) return "Too many attempts. Try again later.";
  if (status >= 500) return `The server had a problem (HTTP ${status}). Try again.`;
  return `Request failed (HTTP ${status}).`;
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---- Auth (public) ---------------------------------------------------------

export interface AuthStatus {
  needsSetup: boolean;
  admin: Admin | null;
}

export interface InviteInfo {
  email: string;
  role: Role;
  expiresAt: string;
}

export const auth = {
  status: () => request<AuthStatus>("/auth/status"),
  login: (email: string, password: string) =>
    request<{ admin: Admin }>("/auth/login", "POST", { email, password }),
  setup: (body: { setupToken: string; email: string; name: string; password: string }) =>
    request<{ admin: Admin }>("/auth/setup", "POST", body),
  logout: () => request<void>("/auth/logout", "POST"),
  invite: (token: string) => request<InviteInfo>(`/auth/invites/${encodeURIComponent(token)}`),
  acceptInvite: (token: string, body: { name: string; password: string }) =>
    request<{ admin: Admin }>(`/auth/invites/${encodeURIComponent(token)}/accept`, "POST", body),
};

// ---- Admin API ---------------------------------------------------------------

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

// The app the app-level calls act on. Null means the org's only app (the
// server picks it), which is how a single-app deployment has always worked.
let currentAppId: string | null = null;
export function setCurrentApp(id: string | null) {
  currentAppId = id;
}
const appBase = () => (currentAppId ? `/admin/apps/${encodeURIComponent(currentAppId)}` : "/admin");

const q = (params: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : "";
};

export interface SigningKey {
  keyId: string;
  source: "generated" | "uploaded";
  createdAt: string;
  retired: boolean;
  retiredAt: string | null;
  certificatePem: string;
  fingerprint: string;
}

export const adminApi = {
  me: () =>
    request<{ actor: string; admin: Admin | null; via: "session" | "token" | "env-token" | "access" }>("/admin/me"),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>("/admin/me/password", "POST", { currentPassword, newPassword }),

  updates: (filter: { channel?: string; platform?: string; runtimeVersion?: string; limit?: number }) =>
    request<{ updates: Update[] }>(`${appBase()}/updates${q(filter)}`),
  channels: () => request<{ channels: ChannelRow[] }>(`${appBase()}/channels`),
  promote: (id: string, body: { channel: string; rolloutPct?: number; message?: string }) =>
    request<{ groupId: string; channel: string }>(`${appBase()}/updates/${encodeURIComponent(id)}/promote`, "POST", body),
  rollout: (id: string, pct: number) =>
    request<unknown>(`${appBase()}/updates/${encodeURIComponent(id)}/rollout`, "POST", { pct }),
  rollback: (id: string, toEmbedded: boolean) =>
    request<RollbackResult>(`${appBase()}/updates/${encodeURIComponent(id)}/rollback`, "POST", { toEmbedded }),

  stats: (days: number) => request<Stats>(`${appBase()}/stats${q({ days })}`),
  keys: () =>
    request<{ keys: SigningKey[]; environmentKey: { keyId: string; source: "environment" } | null }>(`${appBase()}/keys`),
  /** A same-origin link the browser can download (the session cookie authenticates it). */
  certificateUrl: (keyId: string) => `${appBase()}/keys/${encodeURIComponent(keyId)}/certificate`,
  createKey: (keyId: string) =>
    request<{ keyId: string; certificatePem: string; fingerprint: string }>(`${appBase()}/keys`, "POST", { keyId }),
  uploadKey: (body: { keyId: string; privateKeyPem: string; certificatePem: string }) =>
    request<{ keyId: string; fingerprint: string }>(`${appBase()}/keys/upload`, "POST", body),
  exportKey: (keyId: string, password: string) =>
    request<{ keyId: string; privateKeyPem: string }>(`${appBase()}/keys/${encodeURIComponent(keyId)}/export`, "POST", {
      password,
    }),
  retireKey: (keyId: string) => request<void>(`${appBase()}/keys/${encodeURIComponent(keyId)}/retire`, "POST"),
  apps: () => request<{ apps: AppInfo[] }>("/admin/apps"),
  createApp: (name: string) => request<AppInfo>("/admin/apps", "POST", { name }),
  audit: () => request<{ entries: AuditEntry[] }>("/admin/audit"),

  team: () => request<{ admins: TeamAdmin[]; invites: PendingInvite[] }>("/admin/admins"),
  invite: (email: string, role: Role) =>
    request<{ inviteUrl: string; expiresAt: string }>("/admin/admins/invites", "POST", { email, role }),
  revokeInvite: (email: string) => request<void>(`/admin/admins/invites/${encodeURIComponent(email)}`, "DELETE"),
  removeAdmin: (id: string) => request<void>(`/admin/admins/${encodeURIComponent(id)}`, "DELETE"),

  tokens: () => request<{ tokens: ApiToken[] }>("/admin/tokens"),
  createToken: (name: string) =>
    request<{ token: string; id: string; name: string; prefix: string }>("/admin/tokens", "POST", { name }),
  revokeToken: (id: string) => request<void>(`/admin/tokens/${encodeURIComponent(id)}`, "DELETE"),
};
