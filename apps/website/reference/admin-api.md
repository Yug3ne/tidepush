# Admin HTTP API

The dashboard and the CLI use the same JSON API. You can call it yourself, for example from scripts.

- Base URL: your server, e.g. `https://ota.example.com`.
- Request and response bodies are JSON (`content-type: application/json`), except asset uploads.
- Errors are `{ "error": "<message>" }` with a matching HTTP status.
- `/auth/*` and `/admin/*` responses have `cache-control: no-store` and security headers.

## Authentication

`/admin/*` accepts three methods, checked in this order:

| # | Method | Who uses it | How |
| --- | --- | --- | --- |
| 1 | **Session cookie** | Dashboard | `__Host-tidepush_session` cookie set by `/auth/login`, `/auth/setup` or invite acceptance. For `POST`/`PUT`/`PATCH`/`DELETE`, the `Origin` header must equal the server's origin, else `403`. |
| 2 | **Bearer API token** | CLI, CI, scripts | `Authorization: Bearer tp_…` (dashboard-created) or a break-glass `ADMIN_API_TOKENS` entry. |
| 3 | **Cloudflare Access JWT** | Dashboard behind Access | `Cf-Access-Jwt-Assertion` header, only if `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are set. The email must belong to an active admin, else `403`. Service tokens without an email get `403`. |

No valid credentials: `401 { "error": "Unauthorized" }`.

### Who can call what

| Endpoints | Session / Access (admin) | Session / Access (owner) | API token / env token |
| --- | --- | --- | --- |
| Updates, assets, channels, stats, audit, `GET /admin/me` | ✓ | ✓ | ✓ |
| `POST /admin/me/password` | session only | session only | `403` |
| `/admin/tokens*` | ✓ | ✓ | `403` |
| `/admin/admins*` | `403` | ✓ | `403` |

### Audit actor

Each change is recorded in the audit log with an actor: the admin's **email** (session or Access), **`token:<name>`** (API token), or **`env-token`** (break-glass).

```sh
curl -H "Authorization: Bearer $TIDEPUSH_API_TOKEN" https://ota.example.com/admin/me
```

```json
{ "actor": "token:ci-github", "admin": null, "via": "token" }
```

## Public auth routes (`/auth/*`)

No authentication needed. Browser `POST`s with an `Origin` from another site are refused (`403`).

### `GET /auth/status`

```json
{ "needsSetup": false, "admin": { "id": "…", "email": "ana@example.com", "name": "Ana", "role": "owner" } }
```

`needsSetup` is `true` when no admin exists. `admin` is the signed-in admin for the current session cookie, or `null`.

### `POST /auth/setup`

Creates the first **owner**. Body:

```json
{ "setupToken": "…", "email": "ana@example.com", "name": "Ana", "password": "at least 12 chars" }
```

| Status | When |
| --- | --- |
| `201 { admin }` + `Set-Cookie` | Created and signed in |
| `401` | Wrong setup token |
| `409` | An admin already exists (setup is closed) |
| `503` | `SETUP_TOKEN` isn't set on the Worker |
| `400` | Invalid email, name or password |

### `POST /auth/login`

```json
{ "email": "ana@example.com", "password": "…" }
```

| Status | When |
| --- | --- |
| `200 { admin }` + `Set-Cookie` | Signed in |
| `401 "Invalid email or password"` | Wrong email or password, or disabled account |
| `429` + `retry-after` | ≥ 5 failures for that email, or ≥ 20 from that IP, in 15 minutes |

### `POST /auth/logout`

`204`. Deletes the session and clears the cookie.

### `GET /auth/invites/:token`

`200 { "email", "role", "expiresAt" }`, `404` unknown, `410` used or expired.

### `POST /auth/invites/:token/accept`

```json
{ "name": "Ben", "password": "…" }
```

`201 { admin }` + `Set-Cookie`. `404` unknown, `410` used or expired, `409` an active admin with that email already exists. If the email belongs to a **removed** admin, the account is re-enabled.

## Account

### `GET /admin/me`

`{ "actor": string, "admin": { id, email, name, role } | null, "via": "session" | "token" | "env-token" | "access" }`

### `POST /admin/me/password`

Session only. Body `{ "currentPassword", "newPassword" }`. `204`; signs out your other sessions. `400` if the current password is wrong; `403` if not called with a session.

## Assets

### `POST /admin/assets/missing`

Body `{ "keys": ["<hex sha256>", …] }` (max 5000). Returns `{ "missing": [...] }`: the keys the server doesn't have.

### `PUT /admin/assets/:key`

Uploads one file. `:key` is the file's hex SHA-256. The body is the raw bytes.

| Header | Meaning |
| --- | --- |
| `content-type` | The file's MIME type, stored and served back |
| `x-file-extension` | e.g. `.png` (optional; `.` + 1–16 letters/digits) |

`201 { "key", "size" }`. `400` if the bytes don't hash to `:key`; `413` if larger than 95 MB. Uploading an existing key is harmless.

## Updates

### `POST /admin/updates`

Creates updates (one per platform) in a new group. Every referenced asset must already be uploaded (`409` lists missing ones).

```json
{
  "channel": "staging",
  "message": "Fix fee copy",
  "gitSha": "a1b2c3d4e5f6",
  "rolloutPct": 100,
  "updates": [
    {
      "platform": "android",
      "runtimeVersion": "3f9c1a7e…",
      "launchAssetKey": "<hex sha256 of the bundle>",
      "assetKeys": ["<hex sha256>", "…"],
      "metadata": {},
      "extra": { "expoClient": { "…": "public app config" } }
    }
  ]
}
```

At most one entry per platform. Response `201`:

```json
{ "groupId": "…", "channel": "staging", "createdAt": "2026-10-15T09:30:00.000Z",
  "updates": [{ "id": "…", "platform": "android", "runtimeVersion": "3f9c1a7e…" }] }
```

### `GET /admin/updates`

Query: `channel`, `platform`, `runtimeVersion`, `groupId`, `limit` (default 50, max 500). Newest first.

```json
{ "updates": [{
  "id": "…", "groupId": "…", "channel": "production", "platform": "ios",
  "runtimeVersion": "…", "createdAt": "…", "message": "…", "gitSha": "a1b2c3d4e5f6",
  "rolloutPct": 100, "status": "active", "rolledBackAt": null,
  "sourceUpdateId": null, "createdBy": "token:ci-github",
  "assetCount": 43, "deviceCount": 1280 }] }
```

### `GET /admin/updates/:id`

`:id` is an update id or a group id. `{ "updates": [...] }` (same shape, without counts). `404` if nothing matches.

### `GET /admin/channels`

`{ "channels": [{ "channel", "platform", "runtime_version", "update_count", "last_published_at" }] }`

### `POST /admin/updates/:id/promote`

Body `{ "channel": "production", "rolloutPct": 100, "message": "optional" }`. Copies every **active** update for that id or group. `201 { "groupId", "channel", "updates": [{ "id", "platform", "sourceId" }] }`. `404` if no active update matches.

### `POST /admin/updates/:id/rollout`

Body `{ "pct": 50 }`. `200 { "updates": [{ "id", "platform", "rolloutPct" }] }`.

### `POST /admin/updates/:id/rollback`

Body `{ "toEmbedded": false }`.

```json
{ "results": [
  { "id": "…", "platform": "android", "outcome": "republished", "republishedId": "…" },
  { "id": "…", "platform": "ios", "outcome": "embedded" }
] }
```

`outcome` is `republished`, `embedded` or `rolled_back`. See [Rollbacks](/guides/rollbacks).

## Stats & audit

### `GET /admin/stats?days=30`

`days` 1–365 (default 30). Counts devices seen in that window:

```json
{
  "days": 30,
  "byRuntime": [{ "platform", "runtime_version", "channel", "devices", "last_seen" }],
  "byUpdate": [{ "update_id", "platform", "channel", "runtime_version", "devices", "is_embedded",
                 "message", "created_at", "status", "rollout_pct" }],
  "totals": [{ "platform", "devices" }]
}
```

### `GET /admin/audit`

The latest 200 entries: `{ "entries": [{ "id", "at", "actor", "action", "target", "details_json" }] }`.

Actions: `publish`, `promote`, `rollout`, `rollback`, `setup`, `login`, `logout`, `invite`, `invite_accept`, `invite_revoke`, `admin_remove`, `token_create`, `token_revoke`, `password_change`.

## API tokens (signed-in admins only)

API tokens can't call these (`403`).

| Endpoint | Body | Response |
| --- | --- | --- |
| `GET /admin/tokens` | | `{ "tokens": [{ "id", "name", "prefix", "createdBy", "createdAt", "lastUsedAt" }] }` (not revoked) |
| `POST /admin/tokens` | `{ "name": "ci-github" }` | `201 { "token": "tp_…", "id", "name", "prefix" }`. The plaintext token is returned **only here**. |
| `DELETE /admin/tokens/:id` | | `204`, or `404` |

## Team (owners only)

| Endpoint | Body | Response |
| --- | --- | --- |
| `GET /admin/admins` | | `{ "admins": [{ "id", "email", "name", "role", "createdAt", "lastLoginAt", "disabled" }], "invites": [{ "email", "role", "createdAt", "expiresAt" }] }` |
| `POST /admin/admins/invites` | `{ "email", "role": "owner" \| "admin" }` | `201 { "inviteUrl", "expiresAt" }`; `409` if an active admin has that email |
| `DELETE /admin/admins/invites/:email` | | `204`, or `404` if no pending invite |
| `DELETE /admin/admins/:id` | | `204`: disables the admin and deletes their sessions. `400` removing yourself, `409` last owner, `404` unknown. API tokens they created are **not** revoked. |

## Public routes (no auth)

| Route | Purpose |
| --- | --- |
| `GET /health` | `{ "ok": true }` |
| `GET /manifest` | The Expo Updates endpoint. See [Protocol details](/reference/protocol). |
| `GET /assets/:key` | Asset download. See [Protocol details](/reference/protocol#assets). |
