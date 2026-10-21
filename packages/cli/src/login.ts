import { spawn } from "node:child_process";
import { DEFAULT_WEB_URL } from "./api";
import { deleteCredentials, readCredentials, writeCredentials } from "./credentials";

const CLIENT_ID = "tidepush-cli";
const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

async function post<T>(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; data: T }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as T };
}

/** Opens a URL in the browser, if there is one. Never fails: the URL is printed anyway. */
function openBrowser(url: string) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true })
      .on("error", () => {})
      .unref();
  } catch {
    // No browser here (SSH, CI): the printed link is enough.
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * `tidepush login`: the OAuth device flow (RFC 8628). The CLI shows a code,
 * the person approves it in the browser where they're signed in, and the CLI
 * receives a session token, saved with owner-only permissions.
 */
export async function login(opts: { webUrl?: string; open?: boolean } = {}): Promise<void> {
  const web = (opts.webUrl ?? process.env.TIDEPUSH_WEB_URL ?? DEFAULT_WEB_URL).replace(/\/$/, "");
  const start = await post<DeviceCode & { error_description?: string }>(`${web}/api/auth/device/code`, {
    client_id: CLIENT_ID,
  });
  if (start.status !== 200 || !start.data.device_code) {
    throw new Error(
      `Couldn't start signing in at ${web} (${start.status}). ${start.data.error_description ?? ""}`.trim(),
    );
  }
  const code = start.data;
  const absolute = (u: string) => new URL(u, web).toString();
  const link = absolute(code.verification_uri_complete ?? `${code.verification_uri}?user_code=${code.user_code}`);

  console.log(`Your code: ${code.user_code}`);
  console.log(`Approve it at ${link}`);
  if (opts.open !== false) openBrowser(link);

  let interval = Math.max(1, code.interval) * 1000;
  const deadline = Date.now() + code.expires_in * 1000;
  while (Date.now() < deadline) {
    await sleep(interval);
    const res = await post<{ access_token?: string; error?: string; error_description?: string }>(
      `${web}/api/auth/device/token`,
      {
        grant_type: GRANT_TYPE,
        device_code: code.device_code,
        client_id: CLIENT_ID,
      },
    );
    if (res.status === 429) {
      // Rate limited: wait longer and keep polling.
      interval += 5000;
      continue;
    }
    if (res.data.access_token) {
      const session = await fetch(`${web}/api/auth/get-session`, {
        headers: { authorization: `Bearer ${res.data.access_token}` },
      }).then((r) => r.json() as Promise<{ user?: { email: string } } | null>);
      const email = session?.user?.email ?? "unknown";
      await writeCredentials({ webUrl: web, token: res.data.access_token, email });
      console.log(`✔ Logged in as ${email}`);
      return;
    }
    switch (res.data.error) {
      case "authorization_pending":
        break;
      case "slow_down":
        interval += 5000;
        break;
      case "access_denied":
        throw new Error("The request was denied in the browser.");
      case "expired_token":
        throw new Error("The code expired. Run `npx tidepush login` again.");
      default:
        throw new Error(`Signing in failed: ${res.data.error_description ?? res.data.error ?? res.status}`);
    }
  }
  throw new Error("The code expired. Run `npx tidepush login` again.");
}

/** `tidepush logout`: ends the session on the server and forgets it here. */
export async function logout(): Promise<void> {
  const saved = await readCredentials();
  if (!saved) {
    console.log("Not logged in.");
    return;
  }
  await post(`${saved.webUrl}/api/auth/sign-out`, {}, { authorization: `Bearer ${saved.token}` }).catch(
    () => undefined,
  );
  await deleteCredentials();
  console.log(`✔ Logged out ${saved.email}`);
}
