# Team & access

Anyone who can publish to an app decides what code runs on its users' phones. This page explains who can do what, and how people and CI get in.

## Organizations and apps

- An **organization** holds your apps, your members, your API tokens and your plan.
- An **app** is one Expo app. It has its own update URL, signing key, channels, updates and devices.
- You can belong to several organizations, for example your company's and your own. Switch between them in the dashboard's top bar.

## Roles

Roles are per organization and apply to all its apps.

| Role | Can do |
| --- | --- |
| **owner** | Everything: publish, promote, rollout, rollback, manage apps and API tokens, **plus** invite and remove members, change roles, manage billing, and upload or export signing keys |
| **admin** | Publish, promote, rollout, rollback, create apps, create and revoke API tokens, view everything. Can't manage members, billing or signing keys. |
| **member** | Read-only: updates, devices, adoption and the audit log |

There is always at least one owner. You can't remove the last owner or demote them.

## Signing in

Sign in at [app.tidepush.dev](https://app.tidepush.dev) with **GitHub** or with **email and password**.

| | Detail |
| --- | --- |
| Passwords | 12–256 characters |
| Failed sign-ins | More than 10 attempts a minute from one network are paused for a minute |
| Sessions | Renew as you use them, and end after 7 days without use |
| Changing or resetting your password | Signs you out everywhere else |

Your sessions, in browsers and the CLI, are listed under **Settings → Sessions**, where you can end any of them.

## Inviting members

Owners invite people from **Settings → Members**:

1. Enter the person's email and choose a role.
2. Tidepush emails them an invite link. You can also copy the link and send it yourself.
3. They open the link, sign in or create an account, and join the organization.

Invite links work **once** and last **72 hours**. Owners can cancel pending invites. Inviting someone who is already a member fails.

## Changing roles and removing members

Owners change roles and remove members from **Settings → Members**. Removing a member signs them out of that organization straight away, and every change is written to the audit log.

To leave an organization yourself, use **Settings → Members → Leave**. If you're the only owner, make someone else an owner first.

## API tokens

The CLI on your laptop uses `npx tidepush login`. **CI and scripts** use API tokens instead.

1. Go to **Settings → API tokens** and create a token with a name that says where it's used, such as `github-actions`.
2. Choose its scope: **the whole organization**, or **one app**. Prefer one app.
3. Copy the token (it starts with `tp_`). **It is shown only once.**
4. Give it to the CLI as the `TIDEPUSH_TOKEN` environment variable.

What tokens can't do: invite or remove members, create other tokens, change billing, or touch signing keys. A leaked CI token can't be used to create more credentials or accounts.

Revoke a token from the same page. The list shows when each token was last used, so unused tokens are easy to spot.

## Audit log

The **Audit** page records every publish, promote, rollout change, rollback, sign-in, invite, role change, token change and key action, with who did it and when. People appear by email and tokens as `token:<name>`.

## Recovering access

- **You forgot your password:** use **Forgot password** on the sign-in page, or sign in with GitHub if your account is linked to it.
- **You lost access to your account:** another owner can remove you and invite your new email.
- **The only owner can't sign in:** contact support from the email address on the account. We verify ownership before restoring access.

## Good habits

- Give people the lowest role that works. Most people who only watch releases need **member**.
- Use one API token per CI system, restricted to one app.
- Review **Settings → Members** and **API tokens** when someone leaves the team.
