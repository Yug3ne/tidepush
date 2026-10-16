# How it works

This page follows one update from your laptop to a phone, then explains exactly how the server decides what to send.

## The big picture

```text
expo-updates ──GET /<appId>/manifest──▶ Tidepush update server  (decides what to send, signs it)
             ──GET /<appId>/assets/…──▶ global CDN              (files named by SHA-256, never change)
npx tidepush ──API token or login─────▶ Tidepush                (publish, promote, rollout, rollback)
Dashboard ─────signed-in session──────▶ Tidepush                (same actions, plus team and billing)
```

Phones only ever talk to `https://tidepush.yugenecodes99.workers.dev`. You and your CI talk to Tidepush through the CLI and the dashboard at `https://tidepush-web.yugenecodes99.workers.dev`.

## Part 1: publishing

When you run `npx tidepush publish --channel production -m "Fix typo"` in your app directory:

1. **Find the app.** The CLI reads the app id from `updates.url` in your app config (or from `--app <id>`).
2. **Export.** It runs `npx expo export`. This produces the JavaScript bundle for each platform, every asset, and a `metadata.json` that lists them. It sets `TIDEPUSH_CHANNEL=production` while doing so, so your `app.config.ts` can see which channel it's publishing for.
3. **Read config and runtime version.** It runs `npx expo config` (the public app config, stored with the update) and `npx expo-updates runtimeversion:resolve --platform <p>`, which calculates the runtime version exactly as your build did.
4. **Hash.** It computes the SHA-256 of every file. The hash becomes the file's name (its **key**).
5. **Upload only what's missing.** It asks Tidepush which keys the app doesn't have yet and uploads only those. Tidepush hashes the bytes again and refuses any file whose hash doesn't match its key.
6. **Create the update.** Tidepush records one update per platform, under a shared group id, and writes an audit log entry.

Nothing reaches phones until step 6 succeeds. If an upload fails halfway, simply run `publish` again; files already uploaded are skipped.

## Part 2: the phone checks for an update

Every time the app cold-starts, `expo-updates` sends a request like this:

```http
GET /app_7f3k2m9q/manifest HTTP/1.1
Host: tidepush.yugenecodes99.workers.dev
expo-protocol-version: 1
expo-platform: android
expo-runtime-version: 3f9c1a7e…
expo-channel-name: production
expo-current-update-id: 0b7d…        (what it runs now)
expo-embedded-update-id: 0b7d…       (what was built in)
eas-client-id: 6c2e…                 (random id for this install)
expo-expect-signature: sig, keyid, alg
accept: multipart/mixed,application/expo+json,application/json
```

The server then:

1. **Reads the headers.** If platform, runtime version or channel is missing, it answers `400`.
2. **Loads candidates.** It looks up every update for this app with the same channel, platform and runtime version (newest first).
3. **Picks one** using the rules below.
4. **Records the device.** It saves the client id, platform, runtime, channel and current update id. This feeds the dashboard's adoption numbers and your monthly active device count. (This happens in the background and never slows the answer down.)
5. **Answers**, signed with the app's private key:
   - a **manifest** if there's an update the device should run,
   - a **`noUpdateAvailable`** directive if the device is already on the right update or there's nothing to send,
   - a **`rollBackToEmbedded`** directive if you rolled back everything for that line.

The app checks the signature against the certificate it was built with. Then it downloads the launch asset and any assets it doesn't already have, and checks each file's hash. Asset files are cached at the edge for a year, because a file with a given hash never changes.

On the next cold start, the app runs the new bundle.

## How the server picks an update

For one request, the server looks at all of the app's updates with the device's **channel + platform + runtime version** and goes through them **newest first**:

```text
for each update, newest first:
    skip it if its status is "rolled_back"
    skip it if this device is not inside its rollout percentage
    if the device already runs it   → answer "noUpdateAvailable"
    otherwise                        → answer with this update's manifest

nothing matched:
    if some update in this line was rolled back
       and the device is running a downloaded update (not its embedded one)
                                     → answer "rollBackToEmbedded"
    otherwise                        → answer "noUpdateAvailable"
```

### Rollout bucketing

To decide if a device is "inside" a rollout, the server computes:

```text
bucket = first 4 bytes of SHA-256("<client id>:<update id>") as a number, modulo 100
device is in  ⇔  bucket < rollout percentage
```

What this gives you:

- **Stable.** The same device always gets the same bucket for the same update, so it doesn't flip between versions.
- **Widening keeps people in.** A device in at 10% (bucket 0–9) is still in at 50% (bucket 0–49).
- **Different per update.** Because the update id is in the hash, the same 10% of users are not always the guinea pigs.
- **Fall-through.** A device outside a partial rollout falls through to the next older active update it qualifies for. So during a 10% rollout, the other 90% keep getting the previous update.
- **No client id, no partial rollouts.** A request without `eas-client-id` only gets updates at 100%.

### Why "newer" matters to the phone

`expo-updates` has one important rule of its own: **it only moves forward in time.** If the server offers an update whose `createdAt` is older than what the phone is running, the phone ignores it. On a fresh install, "what the phone is running" is the embedded bundle, whose time is the **build time**.

Two consequences:

1. **Rollback must republish.** To undo a bad update, Tidepush can't just serve the previous one again (it's older). It makes a copy of it with a new id and the current time. See [Rollbacks](/guides/rollbacks).
2. **Build before you publish.** An update published *before* you built the app is older than the embedded bundle, so that build will ignore it. Publish again after building.

## Rollback rules in detail

When you roll back an update (or a group, which means each platform's update):

| Situation | What Tidepush does | What phones get |
| --- | --- | --- |
| It was the newest active update, and an older update at **100%** exists | Marks it `rolled_back` and **republishes** the most recent such older update as a new update | The republished copy (it's "newer", so phones accept it) |
| It was the only active update in its line | Marks it `rolled_back` | `rollBackToEmbedded`: phones go back to the bundle built into the app |
| It wasn't the newest, or the previous one was only partially rolled out | Marks it `rolled_back` | Whatever the newest remaining active update is. Phones already on the bad update stay on it until something newer arrives |
| You passed `--to-embedded` | Marks **every** active update in that line `rolled_back` | `rollBackToEmbedded` |

A "line" means one app + channel + platform + runtime version.

## Who can do what

Publishing, promoting, changing rollouts and rolling back need an **owner** or **admin** of the app's organization, or an API token that belongs to that organization (and to that app, if the token is restricted). Members can look but not change anything. See [Team & access](/guides/team-and-access).
