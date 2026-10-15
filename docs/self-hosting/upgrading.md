# Upgrading & migrations

Upgrading Tidepush means: get the new code, update the database, deploy.

## The safe order

```text
1. git pull            get the new version
2. bun install         update dependencies
3. migrate --remote    add new tables/columns to D1
4. bun run deploy      deploy the new Worker + dashboard
```

**Migrations go before the deploy.** New code may expect new tables. Tidepush migrations only add things, so the **old** code keeps working while the new tables exist; the reverse is not true.

## Step by step

```sh
cd ~/tidepush
git pull
bun install

# See which migrations haven't run yet on Cloudflare
cd apps/server
npx wrangler d1 migrations list tidepush --remote

# Apply them
npx wrangler d1 migrations apply tidepush --remote

# Deploy
cd ../..
bun run deploy
```

`migrations list` shows nothing to apply when you're up to date. `migrations apply` asks for confirmation and records each applied migration in a `d1_migrations` table, so running it twice is safe.

## Read the release notes

Some upgrades need extra steps, for example a new secret (like `SETUP_TOKEN` when admin accounts were added). Check the release notes or the changes to `apps/server/wrangler.jsonc` and `apps/server/.dev.vars.example` before deploying.

## If you keep a fork

If you added your own `routes` or `vars` to `wrangler.jsonc`, merge upstream changes into your fork rather than overwriting the file.

## Rolling back a Tidepush upgrade

Cloudflare keeps previous versions of your Worker:

```sh
cd apps/server
npx wrangler deployments list
npx wrangler rollback
```

This restores the previous Worker code. It does **not** undo database migrations, which is fine because migrations only add things.

::: tip Back up before big upgrades
D1 has [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/): you can restore the database to any minute in the last 30 days (7 on the free plan). You can also export a copy: `npx wrangler d1 export tidepush --remote --output backup.sql`.
:::

## Writing your own migration

Add a new numbered file to `apps/server/migrations/`, for example `0003_my_change.sql`, then:

```sh
bun run --filter @tidepush/server db:migrate:local    # try it locally
npx wrangler d1 migrations apply tidepush --remote    # then on Cloudflare
```

Never edit a migration that has already been applied anywhere; add a new one.
