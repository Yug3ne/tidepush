# Admin accounts & security

The dashboard and the admin API (`/admin/*`) control what code runs on your users' phones. This page explains who can get in and how.

The public parts, `/manifest` and `/assets/*`, need no login: phones use them, and everything they return is signed or hash-checked.

## Roles

| Role | Can do |
| --- | --- |
| **owner** | Everything: publish, promote, rollout, rollback, API tokens, **and** invite or remove admins |
| **admin** | Publish, promote, rollout, rollback, view stats and audit log, create apps, create and revoke API tokens. Can't manage other admins. |
| **member** | Read-only: updates, devices, stats and the audit log. |

There is always at least one owner. You can't remove yourself or the last owner.

## First-run setup

When the database has no admin accounts, the dashboard sends you to **`/setup`**. Creating the first account requires the **setup token**, a secret you set on the Worker:

```sh
cd ~/tidepush/apps/server
SETUP_TOKEN=$(openssl rand -hex 32)
echo "$SETUP_TOKEN"
echo "$SETUP_TOKEN" | npx wrangler secret put SETUP_TOKEN
```

- The first account is always an **owner**.
- If `SETUP_TOKEN` isn't set, setup answers `503` with a message asking you to set it. This stops a stranger from claiming a freshly deployed server.
- A wrong setup token gets `401`.
- **Once an owner exists, setup is closed forever** (`409`), even if you keep the secret. You can delete it: `npx wrangler secret delete SETUP_TOKEN`.

## Inviting teammates

Owners invite people from **Settings → Team**:

1. Enter the person's email and choose a role.
2. Tidepush shows an **invite link** like `https://ota.example.com/invite/<token>`. Tidepush doesn't send email, so send the link yourself over a private channel.
3. The invitee opens the link, sets their name and password, and is signed in.

Invite links are valid for **72 hours** and work **once**. Owners can cancel pending invites. Only a hash of the invite token is stored. Inviting the email of an existing active admin fails with `409`. Opening a used or expired link shows an error (`410`).

## Removing someone

Owners remove an admin in **Settings → Team**. The account is disabled and all of its sessions end immediately. You can't remove yourself (`400`) or the last owner (`409`).

::: warning Removing someone does not revoke their API tokens
API tokens are team credentials (often used by CI), so they keep working after the person who created them is removed. Open **Settings → API tokens** and revoke any token that person created or had access to.
:::

Inviting a removed person again re-enables their account when they accept the invite.

## Passwords

- At least 12 and at most 256 characters.
- Stored as PBKDF2-SHA256 with 100,000 iterations and a random salt per password. The plain password is never stored.
- Change yours in **Settings → Account**. Changing it signs you out everywhere else.
- Emails are compared in lowercase, so `Ana@Example.com` and `ana@example.com` are the same account.

There's no "forgot password" email. If an admin forgets theirs, an owner removes the account and sends a new invite. If the **only** owner is locked out, see [Recovering access](#recovering-access).

## Sessions

Signing in sets a cookie named `__Host-tidepush_session`:

- `HttpOnly` (JavaScript can't read it), `Secure` (HTTPS only), `SameSite=Strict`, for the whole site.
- It lasts at most **7 days**, and ends after **24 hours** without use.
- Only a SHA-256 hash of the session token is kept in the database, so a database leak doesn't hand out sessions.

### CSRF protection

For requests that change something (POST, PUT, PATCH, DELETE) made with the session cookie, the browser's `Origin` header must equal the server's own origin, or the server answers `403`. This blocks other websites from making your browser act on the dashboard.

## Login rate limiting

Failed logins are counted per email and per IP address:

- 5 failures for one email within 15 minutes, **or**
- 20 failures from one IP within 15 minutes

→ further attempts get `429 Too Many Requests` with a `retry-after` header. A successful login clears that email's failures. The error message is always "Invalid email or password", so it doesn't reveal which emails have accounts.

## API tokens

The CLI and CI use **API tokens** instead of passwords.

1. Dashboard → **Settings → API tokens** → create, and give it a name that says where it's used (`ci-github`, `eugene-laptop`).
2. Copy the token. It looks like `tp_` followed by random characters, and is **shown once**.
3. Use it as `TIDEPUSH_TOKEN` (the older name `TIDEPUSH_API_TOKEN` also works). The CLI sends it as `Authorization: Bearer tp_…`. A token can be restricted to one app when you create it.

The list shows each token's name, its first 8 characters (to recognise it), who created it, and when it was last used. Revoke a token to disable it immediately. Only a hash is stored, so a lost token can't be shown again: revoke it and create a new one.

::: info Tokens can't manage tokens or people
API tokens can publish, promote, roll out, roll back and read stats and the audit log. They **cannot** create or revoke API tokens or manage admins: those requests get `403`. Only a signed-in person (dashboard session, or Cloudflare Access mapped to an admin) can. So a leaked CI token can't be used to mint more tokens or add accounts.
:::

The audit log records token actions as `token:<name>`.

### Break-glass tokens (`ADMIN_API_TOKENS`)

For emergencies, for example before any admin exists or if the database's accounts are broken, you can set the optional secret `ADMIN_API_TOKENS`: a comma-separated list of tokens. Each must be at least 32 characters; shorter entries are silently ignored.

```sh
openssl rand -hex 32 | npx wrangler secret put ADMIN_API_TOKENS
```

They work like API tokens (including the `403` on token and admin management) but live outside the database and show up in the audit log as `env-token`. Remove the secret when you don't need it.

## Recovering access

If every owner is locked out:

1. Set a break-glass token with `ADMIN_API_TOKENS` as above. That gives API access for publishing and rollbacks, but **not** admin or token management (which needs a signed-in owner).
2. To get an owner back, work directly on the database with Wrangler. Re-enable the account and make it an owner of your organization again (`org_default` on a self-hosted server):

   ```sh
   npx wrangler d1 execute tidepush --remote --command "
     UPDATE admins SET disabled_at = NULL WHERE email = 'you@example.com';
     INSERT OR REPLACE INTO memberships (org_id, user_id, role, created_at)
       SELECT 'org_default', id, 'owner', strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM admins WHERE email = 'you@example.com';"
   ```

   If the password is the problem, sign in with a new one by setting it from a shell in this repository:

   ```sh
   HASH=$(TP_PW='new password here' bun -e 'import { hashPassword } from "./apps/server/src/auth/password"; console.log(await hashPassword(process.env.TP_PW))')
   npx wrangler d1 execute tidepush --remote --command "
     UPDATE auth_account SET password = '$HASH' WHERE provider_id = 'credential'
       AND user_id = (SELECT id FROM admins WHERE email = 'you@example.com');"
   ```

   Anyone with access to your Cloudflare account can do this, which is why your Cloudflare account itself needs strong protection (2FA).

## Security headers

Dashboard, `/auth/*` and `/admin/*` responses include `x-content-type-options: nosniff`, `referrer-policy: same-origin`, `x-frame-options: DENY`, and the dashboard has a strict Content Security Policy (`default-src 'self'`). Admin and auth responses are `cache-control: no-store`.

## Optional: Cloudflare Access

[Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) (part of Cloudflare Zero Trust, free for up to 50 users) can put your company's single sign-on **in front of** the dashboard. Tidepush treats it as an **extra layer, not a replacement**:

- An Access identity is only accepted if its email belongs to an **active Tidepush admin**. Otherwise: `403`.
- Access **service tokens** (which have no email) are rejected on their own with `403`. Machines must still send a `tp_` API token.
- Your Tidepush roles still apply.

### Set it up

1. Serve the dashboard on its own hostname, e.g. `ota-admin.example.com` (see [Custom domain](./custom-domain.md#a-separate-admin-hostname-optional)).
2. In Zero Trust → **Access → Applications**, add a **self-hosted** application for `ota-admin.example.com` with a policy for your team. Also add the path `ota.example.com/admin` to the same application, so the admin API on the public hostname is protected too.
3. Copy the application's **AUD tag**.
4. In `apps/server/wrangler.jsonc` set:

   ```jsonc
   "vars": {
     "CODE_SIGNING_KEY_ID": "main",
     "ACCESS_TEAM_DOMAIN": "yourteam.cloudflareaccess.com",
     "ACCESS_AUD": "<the AUD tag>"
   }
   ```

5. Deploy with `bun run deploy`.

The Worker verifies the `Cf-Access-Jwt-Assertion` header itself (signature, issuer, audience, expiry). It never trusts the Access edge alone.

### CLI and CI behind Access

If `/admin` on the hostname the CLI uses is behind Access, create an Access **service token**, allow it in the Access policy, and set both of these next to your API token:

```sh
TIDEPUSH_ACCESS_CLIENT_ID=<client id>.access
TIDEPUSH_ACCESS_CLIENT_SECRET=<client secret>
```

The CLI sends them as `cf-access-client-id` / `cf-access-client-secret` so it gets through Access, and still authenticates to Tidepush with its `tp_` token.
