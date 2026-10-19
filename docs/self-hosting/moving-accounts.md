# Moving between Cloudflare accounts

A common path: try Tidepush on a personal Cloudflare account, then move it to the company account before launch.

## What has to move

| Thing | Where it lives | How to move it |
| --- | --- | --- |
| Update history, devices, admins, audit log | D1 database `tidepush` | Export and import |
| Bundles and images | R2 bucket `tidepush-assets` | Copy objects |
| Private key | API Worker secret | Put the same PEM again |
| `KEY_ENCRYPTION_KEY` | API Worker secret | Put the **same** value again, or other apps' keys can't be decrypted |
| `SETUP_TOKEN`, `ADMIN_API_TOKENS` | API Worker secrets | Only if you still need them |
| `BETTER_AUTH_SECRET`, web app vars | Web app secret and `apps/web/wrangler.jsonc` | Set them for the new addresses (a new secret is fine) |
| The address phones use | `updates.url` in your app builds | See below; this is the hard part |

## The address problem

Phones ask the address that was **built into the app**. A workers.dev address includes your account's subdomain (`tidepush.<subdomain>.workers.dev`), so it changes when you change accounts.

- If installed builds use a **workers.dev** address, they'll keep asking the old account. Keep the old Worker running until those builds are gone, or keep publishing to both.
- If they use a **custom domain** (`ota.example.com`), move the domain to the new account and the phones won't notice. This is why you should set up a [custom domain](./custom-domain.md) before your first store release.

## Option A: start fresh (simplest)

If you haven't shipped a store build with the old address, don't migrate data at all:

1. Follow the [deploy guide](./deploy.md) steps 3–5 (API Worker, web app, first owner) on the new account. Use the **same private key** if your app already contains its certificate.
2. Change `updates.url` in the app, make new builds.
3. Delete the old Workers (`tidepush` and `tidepush-web`), D1 database and R2 bucket.

## Option B: copy everything

### 1. Export from the old account

```sh
cd ~/tidepush/apps/server
npx wrangler login                 # as the OLD account
npx wrangler d1 export tidepush --remote --output tidepush.sql
```

Copy the R2 objects. R2 is S3-compatible, so any S3 tool works. For example with [rclone](https://rclone.org), using an R2 API token for each account (R2 → Manage API tokens):

```sh
rclone copy old-r2:tidepush-assets new-r2:tidepush-assets --progress
```

### 2. Set up the new account

```sh
npx wrangler logout && npx wrangler login     # as the NEW account
npx wrangler r2 bucket create tidepush-assets
cd ~/tidepush && bun run --filter @tidepush/server deploy    # creates the D1 database
```

Deploy the web app after the import (step 4).

### 3. Import

```sh
cd apps/server
npx wrangler d1 execute tidepush --remote --file tidepush.sql
```

The export includes the schema and the `d1_migrations` record, so **don't** run `migrations apply` before importing (the tables would already exist). After the import, run `npx wrangler d1 migrations list tidepush --remote` to confirm nothing is pending.

### 4. Secrets

```sh
npx wrangler secret put CODE_SIGNING_PRIVATE_KEY < /path/to/private-key.pem
echo "<the same value as before>" | npx wrangler secret put KEY_ENCRYPTION_KEY
```

Use the **same** key; your builds trust only its certificate. The same goes for `KEY_ENCRYPTION_KEY`, which unlocks the keys of any apps you created.

Then set up and deploy the web app on the new account as in [deploy, step 4](./deploy.md#4-deploy-the-web-app): `BETTER_AUTH_URL` and `UPDATES_URL` for the new addresses, `BETTER_AUTH_SECRET`, deploy, then `WEB_URL` on the API Worker and `bun run deploy`.

### 5. Check and switch

- Open the new web app and sign in with your existing email and password (people were copied).
- API tokens were copied too. Create new ones anyway and revoke the old ones. Run `tidepush login` again if you use it.
- Move the custom domain, or update `TIDEPUSH_SERVER_URL` for the CLI.

### 6. Clean up

Delete `tidepush.sql` (it contains password hashes and device ids). When nothing points at the old account anymore, delete the old Workers, database and bucket.
