# Database schema

Tidepush uses one D1 (SQLite) database named `tidepush`. The schema is defined by the migrations in `apps/server/migrations/`:

| File | Adds |
| --- | --- |
| `0001_init.sql` | `assets`, `updates`, `update_assets`, `devices`, `audit_log` |
| `0002_auth.sql` | `admins`, `sessions`, `api_tokens`, `invites`, `login_failures` |

All times are ISO 8601 strings in UTC (e.g. `2026-10-15T09:30:00.000Z`). Ids are UUIDs unless noted.

```text
updates ──< update_assets >── assets          (files live in R2 at assets/<key>)
   │
   └─ group_id groups the per-platform updates of one publish/promote/rollback

devices      one row per app install (by eas-client-id)
audit_log    append-only history

admins ──< sessions
api_tokens, invites, login_failures
```

## Updates and files

### `assets`

One row per unique file. Shared between updates.

| Column | Type | Notes |
| --- | --- | --- |
| `key` | TEXT PK | Hex SHA-256 of the file |
| `hash` | TEXT | Base64url SHA-256 (what `expo-updates` verifies) |
| `content_type` | TEXT | MIME type |
| `file_ext` | TEXT | e.g. `.png` |
| `r2_key` | TEXT | Object key in R2: `assets/<key>` |
| `size` | INTEGER | Bytes |
| `created_at` | TEXT | |

### `updates`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT PK | |
| `group_id` | TEXT | Shared by all platforms of one publish, promote or republish |
| `channel` | TEXT | |
| `platform` | TEXT | `ios` or `android` |
| `runtime_version` | TEXT | |
| `created_at` | TEXT | Used for "newest" and by the client's "only move forward" rule |
| `message` | TEXT | |
| `git_sha` | TEXT | First 12 characters, `-dirty` suffix if uncommitted changes |
| `launch_asset_key` | TEXT → `assets.key` | The JS bundle |
| `metadata_json` | TEXT | Manifest `metadata` |
| `extra_json` | TEXT | Manifest `extra` (includes `expoClient`) |
| `rollout_pct` | INTEGER | 0–100, default 100 |
| `status` | TEXT | `active` or `rolled_back` |
| `rolled_back_at` | TEXT | Set when rolled back |
| `source_update_id` | TEXT | Set on promoted and republished copies |
| `created_by` | TEXT | Actor (email, `token:<name>`, `env-token`) |

Indexes: `(channel, platform, runtime_version, created_at DESC)` for manifest lookups, and `(group_id)`.

### `update_assets`

Links updates to their files (including the launch asset). PK `(update_id, asset_key)`.

### `devices`

One row per app install, updated on every manifest request that includes `eas-client-id`.

| Column | Notes |
| --- | --- |
| `client_id` PK | `eas-client-id` |
| `platform`, `runtime_version`, `channel` | As last reported |
| `current_update_id` | What it ran at its last check (lowercased) |
| `embedded_update_id` | Its embedded bundle's id |
| `last_seen` | Last check time |

No user data is stored: the client id is a random per-install value.

### `audit_log`

| Column | Notes |
| --- | --- |
| `id` | Autoincrement |
| `at` | Time |
| `actor` | Email, `token:<name>` or `env-token` |
| `action` | `publish`, `promote`, `rollout`, `rollback`, `setup`, `login`, `logout`, `invite`, `invite_accept`, `invite_revoke`, `admin_remove`, `token_create`, `token_revoke`, `password_change` |
| `target` | Update/group id, email, or other id |
| `details_json` | Action-specific JSON |

## Accounts

### `admins`

| Column | Notes |
| --- | --- |
| `id` PK | |
| `email` UNIQUE | Lowercased, trimmed |
| `name` | |
| `password_hash` | `pbkdf2-sha256$100000$<salt b64url>$<hash b64url>` |
| `role` | `owner` or `admin` |
| `created_at`, `last_login_at` | |
| `disabled_at` | Set when removed. Rows are never deleted, so the audit trail stays readable. |

### `sessions`

| Column | Notes |
| --- | --- |
| `token_hash` PK | SHA-256 of the cookie value (the cookie itself is never stored) |
| `admin_id` | → `admins.id` |
| `created_at`, `expires_at` | 7-day absolute lifetime |
| `last_seen_at` | For the 24-hour idle timeout; updated at most every 5 minutes |
| `user_agent`, `ip` | For your information |

### `api_tokens`

| Column | Notes |
| --- | --- |
| `id` PK | |
| `name` | |
| `token_hash` UNIQUE | SHA-256 of the full `tp_…` token |
| `prefix` | First 8 characters after `tp_`, for display |
| `created_by` | Actor who created it |
| `created_at`, `last_used_at` | `last_used_at` updated at most every 5 minutes |
| `revoked_at` | Set when revoked |

### `invites`

`token_hash` PK (SHA-256 of the invite token), `email`, `role`, `created_by`, `created_at`, `expires_at` (72 h), `accepted_at`.

### `login_failures`

`id`, `email`, `ip`, `at`. Used for rate limiting; rows older than a day are pruned on new failures.

## Querying it yourself

```sh
cd apps/server
npx wrangler d1 execute tidepush --remote \
  --command "SELECT channel, platform, COUNT(*) FROM devices GROUP BY 1, 2"
```

Use `--local` instead of `--remote` for your local dev database.
