# Troubleshooting

Start with the device logs. They usually say exactly what happened.

```sh
adb logcat | grep -i -E "expo-updates|ExpoUpdates|dev.expo.updates"
```

On iOS: Console.app → your device → filter for `expo-updates`.

## The app never picks up my update

Work through these in order.

### 1. Is it a release build?

`expo-updates` does nothing in debug / development builds (anything connected to Metro). Build with `npx expo run:android --variant release` or `npx expo run:ios --configuration Release`, or a store / EAS build.

### 2. Did you relaunch twice?

The first cold start downloads the update; the second runs it. "Cold start" means fully closing the app (swipe it away), not just switching apps.

### 3. Do the runtime versions match?

The update is only offered to builds with the **exact same** runtime version.

- Compare the runtime in `bun run tidepush list` with the one in the dashboard's Devices page for your phone.
- Or ask Expo what the app's current code resolves to:

  ```sh
  cd ~/my-app
  npx expo-updates runtimeversion:resolve --platform android
  ```

Common causes of a mismatch with the `fingerprint` policy:

- You changed a native dependency, a config plugin or `app.json` after building. That's working as intended: rebuild.
- Different `node_modules` between the build machine and the publish machine. Install with the same lockfile on both.
- Staging vs production builds without the [`fingerprint.config.js`](https://tidepush-website.yugenecodes99.workers.dev/guides/channels#the-problem-this-creates-and-fingerprint-config-js) hook.
- Environment variables that change the app config (`app.config.ts`) differ between build and publish.

### 4. Was the update published after the build?

Phones ignore updates older than their own build. If you published, then built, then installed: publish again.

### 5. Is the channel right?

The build sends `expo-channel-name`. Check what it was built with:

```sh
npx expo config --type public | grep -A3 requestHeaders
```

- With `app.config.ts`, the channel comes from `TIDEPUSH_CHANNEL` **at prebuild time**. Did you run `npx expo prebuild --clean` with the right value?
- With **EAS Build**, a `channel` in `eas.json` overrides the header. Remove it or make it match.

### 6. Is the rollout at 100%?

At a lower percentage your device may simply not be in the bucket. Try `bun run tidepush rollout <id> 100`.

### 7. Is the URL right?

`updates.url` must end with `/manifest`, and be reachable from the phone. Open `https://<server>/manifest?platform=android&runtime-version=x&channel=production` in the phone's browser: you should get a small multipart response, not an error page.

### 8. Signature problems

Logs mention code signing, signature or certificate:

- The server's `CODE_SIGNING_PRIVATE_KEY` doesn't match the app's `certs/certificate.pem`. Was the key regenerated? A new key needs a new build. See [Code signing & keys](./code-signing.md).
- `CODE_SIGNING_KEY_ID` (server) ≠ `codeSigningMetadata.keyid` (app). Both default to `main`.
- The secret is missing: the server then answers `500` to apps that expect a signature. Run `npx wrangler secret list` in `apps/server`.

## The app went back to an old version

- Someone rolled back: check the dashboard's audit log.
- The update crashed on launch. `expo-updates` automatically falls back to the previous working update if a new one crashes before it's ready. Check your crash reports for the new bundle.

## CLI errors

### `Not logged in. Run npx tidepush login, or set TIDEPUSH_TOKEN`

The CLI found no token. Make sure `.env` (with `TIDEPUSH_SERVER_URL` and `TIDEPUSH_TOKEN`) is in the directory you run `bun run tidepush` from (the Tidepush repo root), or export the variables. Without `TIDEPUSH_SERVER_URL` the CLI talks to the hosted service, not your server. Or sign in with `bun run tidepush login --web <your web app URL>`.

### `This organization has N apps. Choose one`

Your server has more than one app. Pass `--app <appId>`, set `TIDEPUSH_APP_ID`, or put the app's URL (`…/<appId>/manifest`) in its `updates.url`, which the CLI reads.

### `401: Unauthorized`

The token is wrong, revoked, or for a different server. Create a new one in **Settings → API tokens**. Break-glass tokens shorter than 32 characters are ignored, so they also give `401`.

### `403`

- Using an API token to manage tokens or people, create apps or change signing keys: only people signed in to the web app can do that.
- Dashboard: `Cross-origin request refused` means the request's `Origin` didn't match the web app's address. Open the dashboard at its `BETTER_AUTH_URL`, and don't put a proxy that rewrites the host in front of it.

### `409: missing assets: …`

Some files weren't uploaded before the update was created, usually after a failed upload. Run `publish` again; finished uploads are skipped.

### `413: asset too large`

A file is over 95 MB. See [Costs & limits](./costs.md#limits-in-tidepush).

### `does not depend on expo-updates`

`--app-dir` / `TIDEPUSH_APP_DIR` points at the wrong folder. It must contain the Expo app's `package.json`.

### `Could not resolve a runtime version`

Your app config has no `runtimeVersion`. Add `"runtimeVersion": { "policy": "fingerprint" }`.

### `npx expo export … exited 1`

The export itself failed; the lines above show Expo's error. Run `npx expo export` in the app directly to debug. Install the app's dependencies first.

## Dashboard problems

### The API Worker's address shows `{"error":"Not found"}`

The API Worker has no web pages; the dashboard is the web app. Open the web app's URL instead. Set `WEB_URL` on the API Worker (then redeploy it) so its `/` redirects there.

### Sign-in fails, or works only on some addresses

The web app accepts sign-in only on its own address, `BETTER_AUTH_URL` in `apps/web/wrangler.jsonc`. Open it there: locally that's `http://localhost:3000`, not a LAN address like `http://192.168.1.20:3000`. If you moved the web app to a new domain, update `BETTER_AUTH_URL` and redeploy it.

### `Too many attempts. Try again in a minute.`

More than 10 sign-in attempts in a minute from one IP. Wait a minute.

### Sign-up says it's closed

That's expected on a self-hosted server. Ask an owner for an invite. "Continue with GitHub" only works for people who already have an account with the same email.

### I forgot my password

Use **Forgot password** on the sign-in page. The email needs `EMAIL_FROM` set on the web app; without it, the reset link is only in the web app's logs (`npx wrangler tail tidepush-web`). See [Passwords](./admin-accounts.md#passwords).

### Setup page says setup is disabled (`503`)

Set the secret on the API Worker: `npx wrangler secret put SETUP_TOKEN` (in `apps/server`). Locally, run `scripts/dev-vars.sh` and restart `bun run dev`.

### Setup says it's already complete (`409`)

An owner exists. Sign in, or ask an owner for an invite.

### Invite link says used or expired (`410`)

Invites work once and last 72 hours. Ask an owner for a new one.

### I'm the only owner and I'm locked out

See [Recovering access](./admin-accounts.md#recovering-access).

## Deployment problems

### `Please enable R2 through the Cloudflare Dashboard`

R2 must be turned on once per account (it asks for a payment method even for the free tier). Dashboard → R2 → enable, then `npx wrangler r2 bucket create tidepush-assets` again.

### `The bucket … does not exist` on deploy

Create it first: `npx wrangler r2 bucket create tidepush-assets`.

### `no such table: updates` / `no such table: admins`

Migrations haven't been applied to the remote database: `npx wrangler d1 migrations apply tidepush --remote` from `apps/server`.

### The web app's deploy fails with a service binding error

The web app binds to the API Worker (`tidepush`, entrypoint `Internal`), so the API Worker must be deployed first. Deploy it (`bun run --filter @tidepush/server deploy`), then the web app. `bun run deploy` does both in that order.

### The dashboard shows errors or won't sign in after deploy

- `BETTER_AUTH_SECRET` isn't set on the web app: `cd apps/web && npx wrangler secret put BETTER_AUTH_SECRET`, then redeploy it.
- `BETTER_AUTH_URL` doesn't match the address you opened. Fix it in `apps/web/wrangler.jsonc` and redeploy.
- Migrations haven't been applied (see above).

### Wrangler deploys to the wrong account

`npx wrangler whoami` shows the account. If you belong to several, Wrangler asks which one, or set `CLOUDFLARE_ACCOUNT_ID` in your shell (don't commit it to `wrangler.jsonc`).
