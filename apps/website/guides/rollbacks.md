# Rollbacks

A rollback stops a bad update from being served and gets devices off it.

```sh
npx tidepush rollback <updateOrGroupId>
npx tidepush rollback <updateOrGroupId> --to-embedded
```

You can also roll back from the dashboard.

## Why Tidepush republishes

`expo-updates` has a safety rule: **a phone never switches to an update that is older than the one it runs.** (It compares the `createdAt` times.)

So if you publish update **B** on top of update **A**, and B is bad, the server can't just start sending A again. Phones on B would see "A is older" and ignore it.

Tidepush solves this by **republishing**: it creates a new update **A′** with A's exact files but a **new id and the current time**. A′ is newer than B, so phones accept it.

```text
time ──────────────────────────────────────────────────────────▶
   A (100%)          B (bad)            A′ = copy of A
   published         published          created by rollback
                     marked rolled_back
phones:  A  ───────▶  B  ───────────────▶  A′
```

The republished update's message says what happened, for example `Rollback of 4f2a…: republish 0b7d… (Fix fee copy)`.

## What happens in each case

| Situation | Result |
| --- | --- |
| B was the newest active update, and an older update at **100%** exists | B is marked `rolled_back`; the most recent such update is **republished**. CLI: `previous update republished as <id>` |
| B was the only active update in its line | B is marked `rolled_back`; phones get a signed **`rollBackToEmbedded`** directive and return to the bundle in the app. CLI: `devices will roll back to the embedded bundle` |
| B wasn't the newest, or the older update was only partial | B is marked `rolled_back` and stops being served. Phones get the newest remaining active update. CLI: `rolled back` |
| `--to-embedded` | **Every** active update in the line (channel + platform + runtime) is marked `rolled_back`; phones go back to the embedded bundle |

A group id rolls back each platform's update separately, so the outcome can differ per platform.

## Roll back to embedded

The **embedded bundle** is the JavaScript built into the app. Going back to it is the "known good" option when you don't trust any published update:

```sh
npx tidepush rollback <groupId> --to-embedded
```

Phones that run a downloaded update get the `rollBackToEmbedded` directive and, on the next launch after that, run the embedded bundle again. Phones already on the embedded bundle are told `noUpdateAvailable`.

To start shipping updates again afterwards, just publish. A new update is newer than the rollback, so it's served normally.

## Fixing forward

Often the fastest fix is not a rollback but a new update with the fix. Since every new publish is newer than everything before it, it's always accepted. Use rollback when you need the bad code gone **now** while you work on the fix.

## Rollbacks are recorded

Each rollback writes an audit log entry with who did it and the outcome per platform. Rolled-back updates stay in the list (status `rolled_back`) so you can see the history; they're just never served again.

::: tip Rollback is not undoable
There's no "un-rollback", and rolled-back updates can't be promoted. If you rolled back by mistake, check out the same commit in your app and publish again.
:::
