# Security model

Tidepush decides what code runs on your users' phones. This page explains what protects that, what each layer defends against, and what you're responsible for.

## What we're protecting

1. **Integrity of updates**: phones must only run JavaScript you published.
2. **Control of the server**: only your team can publish, roll out or roll back.
3. **Secrets**: the signing key, tokens and passwords.

## Layer 1: code signing (protects the phones)

The app contains your certificate and verifies a signature on every manifest and directive. The manifest contains the SHA-256 of every file, and the app verifies each file after download.

| Attacker can… | Can they make phones run their code? |
| --- | --- |
| Read or modify traffic (e.g. a malicious proxy) | **No.** Signatures and hashes fail; the app keeps what it has. |
| Replace files in R2 | **No.** Hashes don't match the signed manifest. |
| Control the server or D1 but **not** the private key | They can't create a validly signed manifest for new code. They **can** withhold updates or replay an old signed response; the client's "only move forward" rule limits replays. |
| Steal the private key **and** control responses | **Yes.** That's why the key is the crown jewel. |

The private key lives only in the Worker secret (and your password manager). Cloudflare stores secrets encrypted, and they can't be read back through the dashboard or API.

::: warning Signing is optional in expo-updates
Phones verify signatures only if the build includes `codeSigningCertificate`. A build without it accepts unsigned updates from whoever answers its `updates.url`. Always ship with code signing on.
:::

## Layer 2: admin authentication (protects the server)

Anyone who can call `/admin/*` can publish code that **the server will sign**. So admin access is as sensitive as the key itself.

| Control | Detail |
| --- | --- |
| Accounts | Email + password, roles `owner` / `admin`. First owner requires `SETUP_TOKEN`; setup closes once an owner exists. |
| Passwords | PBKDF2-SHA256, 100,000 iterations, 16-byte random salt, constant-time comparison. 12–256 characters. |
| Brute force | 5 failures per email or 20 per IP in 15 min → `429`. Same error for unknown email and wrong password, with a dummy hash on unknown emails so timing doesn't leak which emails exist. |
| Sessions | `__Host-tidepush_session`, HttpOnly, Secure, SameSite=Strict. 7 days max, 24 h idle. Only SHA-256 hashes stored. Password change ends other sessions; removing an admin ends all theirs. |
| CSRF | Cookie-authenticated changes require a same-origin `Origin` header. Cross-origin `POST`s to `/auth/*` are refused (stops login CSRF and forced logout). |
| API tokens | `tp_…`, shown once, stored as SHA-256. Can't manage tokens or admins, so a leaked CI token can't create more credentials or accounts. Revocable; last use tracked. |
| Break-glass | `ADMIN_API_TOKENS` secret, ≥ 32 characters each, same restrictions as API tokens. Leave unset normally. |
| Cloudflare Access (optional) | Extra layer in front. The Worker verifies the JWT itself, and the email must belong to an active admin. |
| Audit | Every publish, promote, rollout, rollback, login, logout, invite, removal, token and password change is logged with the actor. |
| Headers | `nosniff`, `referrer-policy: same-origin`, `x-frame-options: DENY`, CSP `default-src 'self'` on the dashboard, `no-store` on API responses. |

## What you are responsible for

- **Your Cloudflare account.** Anyone with access to it can change secrets, the database or the code. Use 2FA and limit who's a member.
- **The private key.** Store it in a password manager, not on laptops or in Git. See [Code signing & keys](/guides/code-signing).
- **API tokens.** One per person or CI system; revoke unused ones; keep them in CI secrets, not in code.
- **Removing people.** Remove their admin account and revoke tokens they used. Removing an admin does **not** revoke API tokens they created.
- **Keeping Tidepush updated.** See [Upgrading](/guides/upgrading).

## Secrets handling in the repository

- `.dev.vars`, `.env` and `.secrets/` are gitignored. Only `.example` files with fake values are committed.
- `wrangler.jsonc` contains no account ids, database ids or domains.
- CI runs [gitleaks](https://github.com/gitleaks/gitleaks) to catch committed secrets.
- `apps/server/test/fixtures` contains a **test-only** key pair. Never use it for a real app.

## Privacy

The server stores, per install: a random client id, platform, runtime version, channel, current and embedded update ids, and last-seen time. It doesn't store IP addresses for devices, user ids or anything from inside your app. For admins it stores email, name, password hash, and session IP and user agent.

## Reporting a vulnerability

Please report privately through GitHub's **private vulnerability reporting**: on the [repository](https://github.com/Yug3ne/tidepush), open **Security → Report a vulnerability**. Don't open a public issue. Include what's affected, how to reproduce it, and the impact you expect. We aim to acknowledge reports within 3 working days. See `SECURITY.md` in the repository.
