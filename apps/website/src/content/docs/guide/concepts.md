---
title: "Key concepts"
---

These words are used across the whole documentation. Each one is explained in plain terms first, then with the exact detail.

## Update

One published version of your JavaScript bundle and its assets, for **one platform**, **one channel** and **one runtime version**.

Every update has:

- an **id** (a UUID such as `9b0e6c1d-2f4a-4c51-9d7e-0f3a5b8c1e22`),
- a **created time** (`createdAt`),
- a **message** you wrote when you published (for example "Fix fee copy"),
- a **rollout percentage** and a **status** (`active` or `rolled_back`).

### Update group

When you publish for both iOS and Android, Tidepush creates **two** updates (one per platform) and links them with a shared **group id**. Every CLI command accepts either an update id or a group id. Using the group id acts on both platforms at once.

## Platform

`ios` or `android`. iOS and Android get different JavaScript bundles, so they are always separate updates.

## Channel

A named line of updates, such as `production` or `staging`. Each build of your app asks for exactly one channel. It does this by sending the HTTP header `expo-channel-name` on every update check.

- A **production** build only ever sees updates published to `production`.
- A **staging** build (for testers) only sees `staging`.

The channel is baked into the build. Changing it means making a new build. See [Channels & promoting](/guides/channels).

## Runtime version

A label that says "which native code is this build running". An update is only offered to builds with the **exact same** runtime version, so JavaScript never runs on native code it wasn't made for.

You choose how it is calculated in your app config with a **runtime version policy**:

| Policy | How the runtime version is calculated | When to use |
| --- | --- | --- |
| `fingerprint` | A hash of everything that affects native code (dependencies with native code, config plugins, native folders). | **Recommended.** It changes by itself whenever native code changes. |
| `appVersion` | Your app's `version` (for example `1.0.8`). | Only if you always bump the version when native code changes. |
| A fixed string | Whatever you write, e.g. `"1"`. | Only if you manage it by hand very carefully. |

When you publish, the Tidepush CLI asks Expo to calculate the runtime version **the same way the build did** (`npx expo-updates runtimeversion:resolve`), so they match.

:::caution[Runtime mismatch is the #1 reason an update doesn't arrive]
If the runtime version of the update differs from the one in the build by even one character, the phone is told "no update". See [Troubleshooting](/troubleshooting#the-app-never-picks-up-my-update).
:::

## Embedded bundle

The JavaScript bundle that was built into the app file (APK / IPA). It is what the app runs before it has ever downloaded an update, and what it goes back to if you "roll back to embedded". It also has an update id, and a time (the build time).

## Launch asset and assets

- The **launch asset** is the main JavaScript bundle file (for Hermes apps, a `.hbc` bytecode file). It is the file the app runs.
- **Assets** are every other file the bundle needs: images, fonts, and so on.

Tidepush stores each file once per app, named by its **SHA-256 hash** (a fingerprint of the file's bytes). If an image didn't change between two updates, it is not uploaded or stored again.

## Manifest

The JSON document the server sends back when the app asks for an update. It lists the update id, `createdAt`, runtime version, the launch asset and all assets, each with a download URL and a hash. The app downloads the files and checks every hash.

## Directive

Instead of a manifest, the server can send a short instruction called a **directive**:

- `noUpdateAvailable`: "you're up to date, keep what you have".
- `rollBackToEmbedded`: "stop running downloaded updates and go back to the embedded bundle".

Directives are part of version 1 of the Expo Updates protocol.

## Rollout percentage

How many devices (0–100%) are allowed to get an update. Tidepush decides per device using its **client id**, so a given phone always gets the same answer for the same update. Raising 10% → 50% keeps the first 10% in and adds more. See [Staged rollouts](/guides/staged-rollouts).

## Client id

A random id that `expo-updates` creates once per app install and sends with every check (header `eas-client-id`). Tidepush uses it for rollout bucketing, to count devices in the dashboard, and to count monthly active devices for your plan. It is not linked to a user account.

## Rollback and republish

Rolling back means "stop serving this update". Because `expo-updates` refuses to move to an update that is **older** than the one it runs, Tidepush can't simply serve the previous update again. Instead it **republishes** it: it makes a fresh copy of the previous update with a new id and a new time, so it counts as newer. If there is nothing to go back to, devices are told to go back to the embedded bundle. See [Rollbacks](/guides/rollbacks).

## Promote

Copy an existing update to another channel, for example from `staging` to `production`. The files are exactly the same; only the channel changes, and the copy gets a new id and time. No rebuild, no re-export.

## Code signing

Tidepush signs every manifest and directive with your app's **private key**. It generates a key pair for each app when you create it. The app contains the matching **certificate** and checks the signature before it uses anything. If the signature is missing or wrong, the app ignores the response and keeps running what it has. See [Code signing & keys](/guides/code-signing).

## Organization

The account that owns everything else. An organization has **members** (people) and **apps**. Billing and plan limits apply per organization. When you sign up, Tidepush creates one for you; you can invite others into it. See [Team & access](/guides/team-and-access).

## App

One Expo app in Tidepush. Each app has its own updates, channels, devices, audit entries and **signing key**. If you ship two different apps to the stores, create two apps in Tidepush.

### App id

The public id of an app, such as `app_7f3k2m9q`. It is part of the update URL your build talks to:

```text
https://tidepush.yugenecodes99.workers.dev/app_7f3k2m9q/manifest
```

The CLI reads the app id from `updates.url` in your app config, so you rarely type it. Pass `--app <id>` to override it.

## Access words

| Word | Meaning |
| --- | --- |
| **Owner** | Can do everything, including billing, inviting and removing members, deleting apps and exporting signing keys. Whoever creates the organization is an owner. |
| **Admin** | Can publish, promote, roll out and roll back, and manage apps and API tokens. Can't manage billing or members. |
| **Member** | Read-only: can see updates, devices and the audit log. |
| **API token** | A long secret string starting with `tp_` that CI uses instead of signing in. Created in **Dashboard → Settings → API tokens**. A token belongs to an organization and can be restricted to one app. |
| **Session** | What keeps you signed in to the dashboard: a secure cookie that ends after 7 days without use. `npx tidepush login` gives the CLI its own sign-in on your machine. |
| **Audit log** | A record of every publish, rollout, rollback, sign-in and team change, with who did it. |
