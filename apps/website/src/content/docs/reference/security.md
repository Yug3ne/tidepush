---
title: "Security"
---

Tidepush decides what code runs on your users' phones. This page explains what protects that, what each layer defends against, and what you're responsible for.

## What we're protecting

1. **Integrity of updates**: phones must only run JavaScript you published.
2. **Control of your apps**: only your team can publish, roll out or roll back.
3. **Separation between customers**: nobody outside your organization can see or change your apps.
4. **Secrets**: signing keys, tokens and passwords.

## Layer 1: code signing (protects the phones)

Your app contains its certificate and verifies a signature on every manifest and directive. The manifest contains the SHA-256 of every file, and the app verifies each file after download.

| Attacker can… | Can they make phones run their code? |
| --- | --- |
| Read or modify traffic (e.g. a malicious proxy) | **No.** Signatures and hashes fail; the app keeps what it has. |
| Replace a downloaded file | **No.** Its hash doesn't match the signed manifest. |
| Point your app at another update server (e.g. DNS hijack) | **No.** That server doesn't have your private key. |
| Steal your private key **and** control responses to your app | **Yes.** That's why the key is the crown jewel. |

:::caution[Signing is optional in expo-updates]
Phones verify signatures only if the build includes `codeSigningCertificate`. A build without it accepts unsigned updates from whoever answers its `updates.url`. `npx tidepush init` always sets it up. Never ship a build without it.
:::

## Layer 2: signing keys

| Control | Detail |
| --- | --- |
| One key per app | A key can only sign responses for the app it belongs to. |
| Storage | Private keys are encrypted at rest and only decrypted in memory while signing. They're never shown in the dashboard or returned by the API. |
| Export | Owners only, after signing in again. Every export is in the audit log. |
| Bring your own | Owners can upload their own key, so Tidepush never generated it. |
| Rotation | Add a key with a new key id; old and new builds keep working while you move over. See [Code signing & keys](/guides/code-signing). |

## Layer 3: accounts and access (protects your apps)

Anyone who can publish to an app can publish code that Tidepush will sign. So publishing access is as sensitive as the key itself.

| Control | Detail |
| --- | --- |
| Sign-in | GitHub, or email + password |
| Passwords | PBKDF2-SHA256 with a random salt per password, compared in constant time. 12–256 characters. |
| Brute force | Sign-in and sign-up are rate limited per network (10 a minute). The same error for unknown emails and wrong passwords, so it doesn't reveal which emails have accounts. |
| Sessions | HttpOnly, SameSite=Lax cookie (Secure over HTTPS), signed. They end after 7 days without use. Changing or resetting your password ends your other sessions; removing someone takes away their access to that organization at once. |
| CSRF | Changes require a same-origin request. Cross-site sign-in and sign-out are refused. |
| Roles | owner, admin, member (read-only). See [Team & access](/guides/team-and-access). |
| API tokens | `tp_…`, shown once, stored as a hash. Can be restricted to one app. Can't manage members, tokens, billing or keys, so a leaked CI token can't create more credentials. Revocable; last use shown. |
| Audit log | Every publish, promote, rollout, rollback, sign-in, invite, role change, token change and key action, with who did it |
| Browser hardening | `nosniff`, `referrer-policy: same-origin`, framing denied, a strict Content Security Policy on the dashboard, `no-store` on API responses |

## Layer 4: separation between organizations

- Every app, update, device record, file, token and audit entry belongs to one organization.
- Every request is checked against the organization that owns the app it targets. A request for an app in another organization gets `404`, exactly as if the app didn't exist, so app ids can't be probed.
- Uploaded files are stored per app. Identical files in two organizations are never shared.

## What you are responsible for

- **Your account.** Use GitHub with two-factor authentication, or a strong unique password.
- **The certificate in your app.** Ship every build with code signing on.
- **Exported keys.** If an owner exports a key, store it in a password manager, never in Git or on a laptop.
- **API tokens.** One per CI system, restricted to one app; keep them in CI secrets, not in code; revoke unused ones.
- **Your team.** Give people the lowest role that works. When someone leaves, remove them and revoke tokens they set up. Removing a member does **not** revoke API tokens they created.

## Privacy

For each install of your app, Tidepush stores: a random client id (created by `expo-updates`), platform, runtime version, channel, current and embedded update ids, and last-seen time. It doesn't store device IP addresses, user ids or anything from inside your app. For people on your team it stores email, name, password hash (if they use a password), and the IP and browser of their sessions.

## Reporting a vulnerability

Please report privately through GitHub's **private vulnerability reporting**: on the [repository](https://github.com/Yug3ne/tidepush), open **Security → Report a vulnerability**. Don't open a public issue. Include what's affected, how to reproduce it, and the impact you expect. We aim to acknowledge reports within 3 working days.
