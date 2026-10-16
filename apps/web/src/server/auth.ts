import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { deviceAuthorization } from "better-auth/plugins/device-authorization";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { env } from "cloudflare:workers";
// One password format for the API and the web app: PBKDF2-SHA256 via WebCrypto.
import { hashPassword, verifyPassword } from "../../../server/src/auth/password";

/**
 * Better Auth handles authentication only: people, sessions, GitHub and
 * password sign-in, and the device flow for `tidepush login`. Organizations,
 * apps and roles live in the API (see apps/server/src/tenancy.ts).
 *
 * Tables are the ones from apps/server/migrations/0005_auth.sql: Better Auth's
 * `user` is our `admins` table, so memberships keep pointing at the same ids.
 */
function createAuth() {
  const github =
    env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } }
      : {};

  return betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    user: {
      modelName: "admins",
      fields: { emailVerified: "email_verified", createdAt: "created_at", updatedAt: "updated_at" },
    },
    session: {
      modelName: "auth_session",
      fields: {
        userId: "user_id",
        expiresAt: "expires_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      expiresIn: 7 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      // Keeps session checks off the database for 5 minutes at a time (a signed cookie cache).
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    account: {
      modelName: "auth_account",
      fields: {
        userId: "user_id",
        accountId: "account_id",
        providerId: "provider_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      // Signing in with GitHub under the same verified email links to the existing person.
      accountLinking: { enabled: true, trustedProviders: ["github"] },
    },
    verification: {
      modelName: "auth_verification",
      fields: { expiresAt: "expires_at", createdAt: "created_at", updatedAt: "updated_at" },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 256,
      password: { hash: hashPassword, verify: ({ hash, password }) => verifyPassword(password, hash) },
    },
    socialProviders: github,
    rateLimit: { enabled: true, window: 60, max: 30 },
    databaseHooks: {
      session: {
        create: {
          // People removed from every org are disabled; they can't start new sessions.
          before: async (session) => {
            const user = await env.DB.prepare(`SELECT disabled_at FROM admins WHERE id = ?`)
              .bind(session.userId)
              .first<{ disabled_at: string | null }>();
            if (user?.disabled_at) return false;
            return { data: session };
          },
          after: async (session) => {
            await env.DB.prepare(`UPDATE admins SET last_login_at = ? WHERE id = ?`)
              .bind(new Date().toISOString(), session.userId)
              .run();
          },
        },
      },
    },
    plugins: [
      deviceAuthorization({
        expiresIn: "10m",
        interval: "5s",
        verificationUri: "/cli/approve",
        validateClient: (clientId) => clientId === "tidepush-cli",
        schema: {
          deviceCode: {
            modelName: "auth_device_code",
            fields: {
              deviceCode: "device_code",
              userCode: "user_code",
              userId: "user_id",
              expiresAt: "expires_at",
              lastPolledAt: "last_polled_at",
              pollingInterval: "polling_interval",
              clientId: "client_id",
            },
          },
        },
      }),
      // Lets the CLI use the token from the device flow as `Authorization: Bearer …`.
      bearer(),
      // Must stay last: copies Better Auth's cookies onto TanStack Start's response.
      tanstackStartCookies(),
    ],
  });
}

let auth: ReturnType<typeof createAuth> | undefined;

/** The Better Auth instance, created on first use (bindings are read inside a request). */
export function getAuth() {
  auth ??= createAuth();
  return auth;
}
