# Tidepush Panel

A small desktop app for publishing and managing OTA updates with buttons instead of commands. It looks and
works like gitpanel: Tauri 2 + plain HTML/JS, and every action runs the `tidepush` CLI, so it does exactly what
the CLI would.

- **Updates tab:** every publish (one row per publish, all platforms together) with channel, `live`,
  rollout %, `rolled back`, device count, commit and runtime. Filter by channel. Right-click a row or use `⋯` to
  **Promote** to another channel, **Change rollout**, **Roll back**, **Roll back to the store build**, see details,
  or reuse its message.
- **Publish box:** the message starts as the last commit (`subject (branch sha)`). Pick the channel, platform
  (Android / iOS / Both) and rollout, then **Publish**. Every publish and every change asks for confirmation
  first, showing the commit, runtime and any uncommitted changes. The caret menu has a **dry run** (export only).
- **Runtime check:** the panel resolves the app's runtime version and tells you whether it matches what's on the
  channel. If it says *new runtime*, phones on the current store build won't get the update. You need a new build.
- **Output tab:** live CLI output while a job runs, with Cancel.

## Build & run

    ./install.sh                      # builds, installs ~/.local/bin/tidepanel + a launcher entry
    tidepanel ~/path/to/expo-app      # or run with no argument inside the app / to reopen the last one

Requires Rust and the Tauri 2 Linux dependencies (webkit2gtk-4.1).

## Where settings come from

| What | Default | Override |
| --- | --- | --- |
| Server + API token | this repo's `.env` (`TIDEPUSH_SERVER_URL`, `TIDEPUSH_TOKEN`), else `tidepush login` | `TIDEPANEL_ENV=/path/to/.env` |
| The CLI | `bun packages/cli/src/index.ts` from this repo, else `npx -y tidepush` | `TIDEPANEL_CLI="npx tidepush"` |
| Apps in the switcher (Ctrl P) | folders under `$HOME` whose package.json depends on `expo-updates` | `TIDEPANEL_ROOTS=~/Code:~/work` |

`TIDEPUSH_APP_DIR` in the `.env` is ignored. The panel always passes the open app's folder.

## Keys

| Key | Action |
| --- | --- |
| Ctrl+Enter | publish |
| Ctrl+P / Ctrl+O | switch app / open a folder |
| Ctrl+R | refresh |
| Ctrl+1 / Ctrl+2 | Updates / Output |
| ↑/↓ or j/k, Enter | move through updates, show details |

## Hyprland

    o.window("^(tidepanel)$", { float = true, center = true, size = { 620, "(monitor_h*0.88)" }, tag = "-default-opacity" })
