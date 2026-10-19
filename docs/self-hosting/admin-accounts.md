# Admin accounts & security

The dashboard (the web app) and the admin API (`/admin/*` on the API Worker) control what code runs on your users' phones. This page explains who can get in and how.

The public parts of the API Worker, `/manifest` and `/assets/*`, need no login: phones use them, and everything they return is signed or hash-checked.

## Roles

| Role | Can do |
| --- | --- |
| **owner** | Everything: publish, promote, rollout, rollback, API tokens, signing keys, **and** invite or remove people and change roles |
| **admin** | Publish, promote, rollout, rollback, view stats and audit log, create apps, create and revoke API tokens. Can't manage people or signing keys. |
| **member** | Read-only: updates, devices, stats and the audit log. |

There is always at least one owner. You can't remove yourself or the last owner.

## First-run setup

First-run setup happens in the web app, at **`<web URL>/setup`**. While no accounts exist, the sign-in page sends you there. Creating the first account requires the **setup token**, a secret you set on the API Worker:

```sh
cd ~/tidepush/apps/server
SETUP_TOKEN=$(openssl rand -hex 32)
echo "$SETUP_TOKEN"
echo "$SETUP_TOKEN" | npx wrangler secret put SETUP_TOKEN
```

- The first account is always an **owner** of the server's organization, and is signed in straight away.
- If `SETUP_TOKEN` isn't set, setup refuses (`503`) with a message asking you to set it. This stops a stranger from claiming a freshly deployed server.
- A wrong setup token is refused (`401`).
- **Once an owner exists, setup is closed forever** (`409`), even if you keep the secret. You can delete it: `npx wrangler secret delete SETUP_TOKEN`.

## No public sign-up

A self-hosted server (`TIDEPUSH_MODE` = `selfhost`, the default) has no open sign-up. The web app's `/signup` page says so, and new accounts can't be created by email or by GitHub. People join through invites.

"Continue with GitHub" (if you set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` on the web app) only works for someone who already has an account with the same verified email: it links GitHub to that account. It never creates one.

## Inviting teammates

Owners invite people from **Settings → Team**:

1. Enter the person's email and choose a role.
2. Tidepush makes an **invite link** like `https://<web URL>/invite/<token>`. If `EMAIL_FROM` is set on the API Worker, it emails the link; otherwise copy it and send it yourself over a private channel.
3. The invitee opens the link:
   - **New to this server:** they enter their name and a password. The account is created for the invited email, and they're signed in.
   - **Already has an account:** they sign in and accept.

Invite links are valid for **72 hours** and work **once**. Owners can cancel pending invites. Only a hash of the invite token is stored. Inviting someone who is already a member fails (`409`). Opening a used or expired link shows an error (`410`).

Set `WEB_URL` on the API Worker so invite links and emails point at the web app. See [Configuration](./configuration.md#api-worker-vars).

## Removing someone

Owners remove a person in **Settings → Team**. They lose access at once. Someone left in no organization (on a self-hosted server, that's anyone you remove) is disabled and signed out everywhere. You can't remove yourself (`400`) or the last owner (`409`).

::: warning Removing someone does not revoke their API tokens
API tokens are team credentials (often used by CI), so they keep working after the person who created them is removed. Open **Settings → API tokens** and revoke any token that person created or had access to.
:::

Inviting a removed person again gives them their account back, with the password they choose on the invite page.

## Passwords

- At least 12 and at most 256 characters.
- Stored as PBKDF2-SHA256 with 100,000 iterations and a random salt per password. The plain password is never stored.
- Change yours in **Settings → Account**. Changing it signs you out everywhere else.
- Emails are compared in lowercase, so `Ana@Example.com` and `ana@example.com` are the same account.

**Forgot password** on the sign-in page sends a reset link that works for an hour. That needs `EMAIL_FROM` on the web app; without it, the link is only written to the web app's logs (`npx wrangler tail tidepush-web`). An owner can also remove the person and invite them again; they choose a new password on the invite page. If the **only** owner is locked out, see [Recovering access](#recovering-access).

## Sessions

Sign-in, sign-out and sessions are handled by the web app (Better Auth):

- The session cookie is `HttpOnly` (JavaScript can't read it), `SameSite=Lax`, `Secure` over HTTPS, and signed with `BETTER_AUTH_SECRET`.
- A session ends after **7 days** without use. Using it renews it.
- **Settings → Sessions** lists your sessions, in browsers and the CLI, and lets you end the others.

The web app refuses requests that change something when they come from another site (the `Origin` must be the web app's own). This blocks other websites from making your browser act on the dashboard.

## Sign-in rate limiting

Sign-in and sign-up are limited to **10 attempts per minute per IP address**. Further attempts are refused (`429`) and the page says "Too many attempts. Try again in a minute." The error for a wrong password is always "Invalid email or password", so it doesn't reveal which emails have accounts.

## API tokens

The CLI and CI use **API tokens** instead of passwords.

1. Dashboard → **Settings → API tokens** → create, and give it a name that says where it's used (`ci-github`, `eugene-laptop`).
2. Copy the token. It looks like `tp_` followed by random characters, and is **shown once**.
3. Use it as `TIDEPUSH_TOKEN` (the older name `TIDEPUSH_API_TOKEN` also works), with `TIDEPUSH_SERVER_URL` set to the API Worker's URL. The CLI sends it as `Authorization: Bearer tp_…`. A token can be restricted to one app when you create it.

The list shows each token's name, its first 8 characters (to recognise it), who created it, and when it was last used. Revoke a token to disable it immediately. Only a hash is stored, so a lost token can't be shown again: revoke it and create a new one.

On your own machine you can use `tidepush login --web <web URL>` instead: it signs the CLI in as you after you approve it in the dashboard.

::: info Tokens can't manage tokens or people
API tokens can publish, promote, roll out, roll back and read stats and the audit log. They **cannot** create or revoke API tokens, manage people, create apps or touch signing keys: those requests get `403`. Only a person signed in to the web app can. So a leaked CI token can't be used to mint more tokens or add accounts.
:::

The audit log records token actions as `token:<name>`.

### Break-glass tokens (`ADMIN_API_TOKENS`)

For emergencies, for example before any admin exists or if the database's accounts are broken, you can set the optional secret `ADMIN_API_TOKENS` on the API Worker: a comma-separated list of tokens. Each must be at least 32 characters; shorter entries are silently ignored.

```sh
openssl rand -hex 32 | npx wrangler secret put ADMIN_API_TOKENS
```

They work like API tokens (including the `403` on token and people management) but live outside the database and show up in the audit log as `env-token`. Remove the secret when you don't need it.

## Recovering access

If every owner is locked out:

1. Set a break-glass token with `ADMIN_API_TOKENS` as above. That gives API access for publishing and rollbacks, but **not** people or token management (which needs an owner signed in to the web app).
2. To get an owner back, work directly on the database with Wrangler. Re-enable the account and make it an owner of your organization again (`org_default` on a self-hosted server):

   ```sh
   npx wrangler d1 execute tidepush --remote --command "
     UPDATE admins SET disabled_at = NULL WHERE email = 'you@example.com';
     INSERT OR REPLACE INTO memberships (org_id, user_id, role, created_at)
       SELECT 'org_default', id, 'owner', strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM admins WHERE email = 'you@example.com';"
   ```

   If the password is the problem and password-reset email isn't set up, set a new one from a shell in this repository:

   ```sh
   HASH=$(TP_PW='new password here' bun -e 'import { hashPassword } from "./apps/server/src/auth/password"; console.log(await hashPassword(process.env.TP_PW))')
   npx wrangler d1 execute tidepush --remote --command "
     UPDATE auth_account SET password = '$HASH' WHERE provider_id = 'credential'
       AND user_id = (SELECT id FROM admins WHERE email = 'you@example.com');"
   ```

   Then sign in to the web app with it.

   Anyone with access to your Cloudflare account can do this, which is why your Cloudflare account itself needs strong protection (2FA).

## Security headers

`/admin/*` responses from the API Worker include `x-content-type-options: nosniff`, `referrer-policy: same-origin` and `x-frame-options: DENY`, and are `cache-control: no-store`.

## Optional: Cloudflare Access

[Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) (part of Cloudflare Zero Trust, free for up to 50 users) can put your company's single sign-on **in front of** the dashboard. It's an extra layer: people pass Access first, then still sign in to Tidepush with their own account and role.

### In front of the dashboard

In Zero Trust → **Access → Applications**, add a **self-hosted** application for the web app's hostname (for example `ota-admin.example.com`, or `tidepush-web.<your-subdomain>.workers.dev`) with a policy for your team. Tidepush needs no configuration for this.

`tidepush login` goes through the web app and doesn't send Access credentials. With Access on the web app, give the CLI an API token and `TIDEPUSH_SERVER_URL` instead.

### In front of the admin API

You can also protect `/admin` on the API hostname: add the path `ota.example.com/admin` (your API hostname) to an Access application. The dashboard isn't affected, because it reaches the API Worker through the service binding.

::: danger Never put phones behind Access
Protect only the `/admin` path. `/manifest`, `/<appId>/manifest` and the asset paths must stay public, or installed apps stop getting updates.
:::

For the CLI and CI to get through, create an Access **service token**, allow it in the Access policy, and set both of these next to your API token:

```sh
TIDEPUSH_ACCESS_CLIENT_ID=<client id>.access
TIDEPUSH_ACCESS_CLIENT_SECRET=<client secret>
```

The CLI sends them as `cf-access-client-id` / `cf-access-client-secret` so it gets through Access, and still authenticates to Tidepush with its `tp_` token.
