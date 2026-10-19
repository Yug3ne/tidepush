# Admin HTTP API

The CLI, CI and the dashboard use the same JSON API on the API Worker. You can call it yourself, for example from scripts.

- Base URL: your API Worker, e.g. `https://ota.example.com` (the address phones use, not the web app's).
- Request and response bodies are JSON (`content-type: application/json`), except asset uploads.
- Errors are `{ "error": "<message>" }` with a matching HTTP status.
- `/admin/*` responses have `cache-control: no-store` and security headers.

## Authentication

`/admin/*` accepts:

| # | Method | Who uses it | How |
| --- | --- | --- | --- |
| 1 | **Bearer API token** | CLI, CI, scripts | `Authorization: Bearer tp_…`. Create tokens in the web app's **Settings → API tokens**. |
| 2 | **Break-glass token** | Emergencies | `Authorization: Bearer <token>` with an entry from the `ADMIN_API_TOKENS` secret. Acts on the server's organization. See [Admin accounts](./admin-accounts.md#break-glass-tokens-admin_api_tokens). |
| 3 | **The web app** | Dashboard | The web app calls the API Worker over its service binding, acting for the person signed in to it. Not callable from outside. |

No valid credentials: `401 { "error": "Unauthorized" }`.

### Who can call what

| Endpoints | Signed-in admin (web app) | Signed-in owner (web app) | API token / break-glass token |
| --- | --- | --- | --- |
| Updates, assets, channels, stats, audit, `GET /admin/me`, listing apps and keys, certificates | ✓ | ✓ | ✓ |
| API tokens (`/admin/tokens*`, `/admin/orgs/:orgId/tokens*`) | ✓ | ✓ | `403` |
| Creating, renaming and archiving apps | ✓ | ✓ | `403` |
| People and invites (`/admin/admins*`, `/admin/orgs/:orgId/members*`) | `403` | ✓ | `403` |
| Creating, uploading, exporting and retiring signing keys | `403` | ✓ | `403` |

The last four rows are done in the web app: its **Settings** page for tokens, apps and the team, and each app's **Settings → Code signing** for keys. Exporting a private key also asks for your password again. Members (read-only) can call the first row's reads only.

### Audit actor

Each change is recorded in the audit log with an actor: the person's **email** (web app), **`token:<name>`** (API token), or **`env-token`** (break-glass).

```sh
curl -H "Authorization: Bearer $TIDEPUSH_TOKEN" https://ota.example.com/admin/me
```

```json
{ "actor": "token:ci-github", "admin": null, "via": "token" }
```

## Paths for one app or one organization

The paths below are the **unscoped** forms. They work while your organization has one app (and you belong to one organization), which is every self-hosted server until you create a second app. With several, use the scoped forms; they take the same bodies and return the same JSON:

| Scoped path | Same as |
| --- | --- |
| `/admin/apps/:appId/updates…`, `/assets…`, `/channels`, `/stats`, `/keys…` | `/admin/updates…` etc., for that app |
| `/admin/apps/:appId/audit` | The audit entries for that app |
| `/admin/orgs/:orgId/apps` (`GET`, `POST`), `PATCH /admin/orgs/:orgId/apps/:appId` | List, create, rename or archive apps |
| `/admin/orgs/:orgId/members…` | `/admin/admins…` (team) |
| `/admin/orgs/:orgId/tokens…` | `/admin/tokens…` |
| `/admin/orgs/:orgId/audit`, `/admin/orgs/:orgId/usage` | The organization's audit log; its plan and usage |

An app or organization you can't access answers `404`, the same as one that doesn't exist. Signing keys: `GET /admin/apps/:appId/keys`, `GET …/keys/:keyId/certificate`, and (owners, in the web app only) `POST …/keys`, `POST …/keys/upload`, `POST …/keys/:keyId/export`, `POST …/keys/:keyId/retire`.

## Account

### `GET /admin/me`

`{ "actor": string, "admin": { id, email, name, role } | null, "via": "token" | "env-token" | "internal" }`

`admin` is `null` for tokens. `via` is `internal` when the web app calls for a signed-in person.

Sign-in, sign-out, password changes and first-run setup are handled by the web app, not this API. The API Worker's own `/auth/*` routes answer only the web app's service binding; from the internet they return `404`.

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

`outcome` is `republished`, `embedded` or `rolled_back`. See [Rollbacks](https://tidepush-website.yugenecodes99.workers.dev/guides/rollbacks).

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

Actions: `publish`, `promote`, `rollout`, `rollback`, `setup`, `invite`, `invite_accept`, `invite_revoke`, `admin_remove`, `role_change`, `token_create`, `token_revoke`, `app_create`, `key_create`, `key_export`, `key_retire`. Entries from before the web app may also show `login`, `logout` and `password_change`.

## Public routes (no auth)

| Route | Purpose |
| --- | --- |
| `GET /health` | `{ "ok": true }` |
| `GET /manifest`, `GET /<appId>/manifest` | The Expo Updates endpoint (`/manifest` serves the first app). See [Protocol details](https://tidepush-website.yugenecodes99.workers.dev/reference/protocol). |
| `GET /assets/:key`, `GET /<appId>/assets/:key` | Asset download. See [Protocol details](https://tidepush-website.yugenecodes99.workers.dev/reference/protocol#assets). |
| `GET /` | Redirects to `WEB_URL` (the dashboard) when it's set. |

Any other path returns `404 { "error": "Not found" }`. The API Worker serves no web pages.
