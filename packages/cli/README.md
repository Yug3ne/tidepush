# tidepush

The command-line tool for [Tidepush](https://tidepush.dev): OTA updates for Expo apps.

```sh
npx tidepush login                    # sign in through your browser
npx tidepush init                     # connect this Expo app (updates.url, certificate)
npx tidepush publish --channel production -m "Fix the fee copy"
npx tidepush rollout <groupId> 50
npx tidepush rollback <groupId>
```

In CI, set `TIDEPUSH_TOKEN` to an API token from the dashboard (Settings → API tokens) instead of logging in.

Self-hosting? Point the CLI at your server with `TIDEPUSH_SERVER_URL` (API tokens) or `TIDEPUSH_WEB_URL` (login).

Docs: https://tidepush.dev/reference/cli · License: AGPL-3.0-only
