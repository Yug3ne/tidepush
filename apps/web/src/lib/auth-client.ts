/**
 * Browser-side calls to Better Auth's endpoints (/api/auth/*). A few plain
 * same-origin fetches instead of Better Auth's client library, which would add
 * about 12 KB of JavaScript to every page that signs in or out.
 *
 * Each call resolves to `{ error }` (null on success), like Better Auth's client.
 */

export interface SessionInfo {
  id: string;
  token: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuthError {
  status: number;
  message?: string;
  /** OAuth-style errors from the device flow. */
  error?: string;
  error_description?: string;
}

async function call<T = unknown>(
  path: string,
  body?: unknown,
  method = "POST",
): Promise<{ data: T | null; error: AuthError | null }> {
  let res: Response;
  try {
    res = await fetch(`/api/auth${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    return {
      data: null,
      error: { status: 0, message: "Can't reach the server. Check your connection and try again." },
    };
  }
  const data = (await res.json().catch(() => null)) as (T & Partial<AuthError>) | null;
  if (!res.ok) return { data: null, error: { status: res.status, ...(data ?? {}) } };
  return { data, error: null };
}

export const authClient = {
  signIn: {
    email: (body: { email: string; password: string }) => call("/sign-in/email", body),
    /** Sends the browser to the provider; on return, Better Auth redirects to callbackURL. */
    social: async (body: { provider: "github"; callbackURL: string }) => {
      const result = await call<{ url?: string }>("/sign-in/social", body);
      if (result.data?.url) window.location.href = result.data.url;
      return result;
    },
  },
  signUp: {
    email: (body: { name: string; email: string; password: string }) => call("/sign-up/email", body),
  },
  signOut: () => call("/sign-out", {}),
  /** Emails a reset link if the address has an account; always answers the same way. */
  requestPasswordReset: (body: { email: string; redirectTo: string }) => call("/request-password-reset", body),
  resetPassword: (body: { newPassword: string; token: string }) => call("/reset-password", body),
  listSessions: () => call<SessionInfo[]>("/list-sessions", undefined, "GET"),
  revokeSession: (body: { token: string }) => call("/revoke-session", body),
  revokeOtherSessions: () => call("/revoke-other-sessions", {}),
  changePassword: (body: { currentPassword: string; newPassword: string; revokeOtherSessions?: boolean }) =>
    call("/change-password", body),
  device: Object.assign(
    /** Claims a device code for the signed-in session (required before approving or denying). */
    (opts: { query: { user_code: string } }) =>
      call(`/device?user_code=${encodeURIComponent(opts.query.user_code)}`, undefined, "GET"),
    {
      approve: (body: { userCode: string }) => call("/device/approve", body),
      deny: (body: { userCode: string }) => call("/device/deny", body),
    },
  ),
};
