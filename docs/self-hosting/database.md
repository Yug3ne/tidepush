# Database schema

Tidepush uses one D1 (SQLite) database named `tidepush`, shared by the API Worker and the web app. The schema is defined by the migrations in `apps/server/migrations/`, applied in order:

| File | What it does |
| --- | --- |
| `0001_init.sql` | `assets`, `updates`, `update_assets`, `devices`, `audit_log` |
| `0002_auth.sql` | `admins`, `sessions`, `api_tokens`, `invites`, `login_failures` (the last two dropped by 0007) |
| `0003_tenancy.sql` | `orgs`, `apps`, `memberships`; scopes everything to an org and app. Existing data moves into `org_default` / `app_default`. |
| `0004_signing_keys.sql` | `signing_keys`: each app's own code-signing keys, encrypted |
| `0005_auth.sql` | Passwords move to `auth_account`; `auth_session`, `auth_verification`, `auth_device_code` (the web app's sign-in) |
| `0006_billing.sql` | `orgs.subscribed`, `orgs.over_limit_since`, `device_months` (hosted plans; unused when self-hosted) |
| `0007_retire_legacy_auth.sql` | Drops `sessions` and `login_failures`, used only by the old built-in dashboard |

All times are ISO 8601 strings in UTC (e.g. `2026-10-15T09:30:00.000Z`).

```text
orgs ──< apps ──< updates ──< update_assets >── assets      (files in R2: assets/<key> for app_default,
  │        │         └─ group_id groups one publish/promote/rollback          apps/<appId>/<key> for the others)
  │        ├──< signing_keys
  │        ├──< devices, device_months
  │        └──< api_tokens (optional app_id)
  ├──< memberships >── admins (people) ──< auth_session, auth_account
  ├──< invites
  └──< audit_log
```

## Organizations and apps

| Table | Key columns | Notes |
| --- | --- | --- |
| `orgs` | `id` (`org_…`), `slug`, `name` | A self-hosted server has one: `org_default`. `subscribed` and `over_limit_since` only matter in hosted mode. |
| `apps` | `id` (`app_…`), `org_id`, `name`, `archived_at` | The id is the path in `updates.url`. `app_default` is also served at `/manifest`. |
| `memberships` | (`org_id`, `user_id`), `role` | `owner`, `admin` or `member` (read-only). |
| `signing_keys` | (`app_id`, `key_id`), `private_key_enc`, `certificate_pem`, `retired_at` | `private_key_enc` is AES-256-GCM under `KEY_ENCRYPTION_KEY`, bound to app and key id. `app_default` may have none and use `CODE_SIGNING_PRIVATE_KEY`. |

## Updates and files

| Table | Key columns | Notes |
| --- | --- | --- |
| `updates` | `id`, `app_id`, `group_id`, `channel`, `platform`, `runtime_version`, `created_at`, `rollout_pct`, `status` | `status` is `active` or `rolled_back`. `source_update_id` is set on promotions and republishes. |
| `assets` | (`app_id`, `key`), `hash`, `content_type`, `r2_key`, `size` | `key` is the hex SHA-256; `hash` the base64url one expo-updates checks. Never shared between apps. |
| `update_assets` | (`update_id`, `asset_key`) | Which files an update uses. |
| `devices` | (`app_id`, `client_id`), `platform`, `runtime_version`, `channel`, `current_update_id`, `embedded_update_id`, `last_seen` | One row per install, from `eas-client-id`. |
| `device_months` | (`app_id`, `month`, `client_id`) | Monthly active devices, for hosted plans. |

## People and access

| Table | Key columns | Notes |
| --- | --- | --- |
| `admins` | `id`, `email`, `name`, `email_verified`, `last_login_at`, `disabled_at` | People. Disabled, not deleted, when removed from their last org, so the audit trail stays readable. |
| `auth_account` | `user_id`, `provider_id`, `account_id`, `password` | `provider_id = 'credential'` holds the password: `pbkdf2-sha256$100000$<salt>$<hash>`. GitHub sign-ins add `github` rows. |
| `auth_session`, `auth_verification`, `auth_device_code` | | The web app's sessions, email/password-reset tokens, and `tidepush login` device codes (Better Auth). |
| `api_tokens` | `id`, `org_id`, `app_id`, `token_hash`, `prefix`, `revoked_at` | `tp_…` tokens, stored as SHA-256. `app_id` restricts a token to one app. |
| `invites` | `token_hash`, `org_id`, `email`, `role`, `expires_at`, `accepted_at` | Single use, 72 hours. |
| `audit_log` | `id`, `at`, `org_id`, `app_id`, `actor`, `action`, `target`, `details_json` | Append-only. `org_id` is null for personal events (sign-in, password change). |

## Querying it yourself

```sh
cd apps/server
npx wrangler d1 execute tidepush --remote \
  --command "SELECT channel, platform, COUNT(*) FROM devices GROUP BY 1, 2"
```

Use `--local` instead of `--remote` for your local dev database.
