import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { hashToken } from "../src/auth/tokens";
import { TOKEN } from "./helpers";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// The API token most tests publish with (actor `token:test`).
await env.DB.prepare(
  `INSERT OR IGNORE INTO api_tokens (id, name, token_hash, prefix, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
)
  .bind("test-token-id", "test", await hashToken(TOKEN), TOKEN.slice(3, 11), "test-setup", new Date().toISOString())
  .run();
