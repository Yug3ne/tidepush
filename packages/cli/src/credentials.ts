import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** What `tidepush login` saves: the web app it signed in to and the session token from the device flow. */
export interface Credentials {
  webUrl: string;
  token: string;
  email: string;
}

export const credentialsPath = (env: Record<string, string | undefined> = process.env) =>
  env.TIDEPUSH_CREDENTIALS ?? join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "tidepush", "credentials.json");

export async function readCredentials(path = credentialsPath()): Promise<Credentials | null> {
  try {
    const c = JSON.parse(await readFile(path, "utf8")) as Partial<Credentials>;
    return c.webUrl && c.token && c.email ? { webUrl: c.webUrl, token: c.token, email: c.email } : null;
  } catch {
    return null;
  }
}

export async function writeCredentials(c: Credentials, path = credentialsPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(c, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

export async function deleteCredentials(path = credentialsPath()): Promise<void> {
  await rm(path, { force: true });
}
