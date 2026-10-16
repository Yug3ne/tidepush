# Staged rollouts

A staged rollout sends an update to only part of your users first. If something goes wrong, only that part is affected.

## Publish to a percentage

```sh
npx tidepush publish --channel production --rollout 10 -m "New payment summary screen"
```

About 10% of devices get the update. The other 90% keep getting the update they had before.

## Widen it

```sh
npx tidepush rollout <groupId> 50
npx tidepush rollout <groupId> 100
```

```text
✔ Rollout set to 50% for android 4f2a…, ios 9b0e…
```

Or use the rollout control on the update in the dashboard.

## How devices are chosen

Each device has a random **client id** that `expo-updates` creates on install. For each update, the server computes a number from 0 to 99:

```text
bucket = SHA-256("<client id>:<update id>")  →  first 4 bytes  →  mod 100
```

The device is in the rollout if `bucket < percentage`.

```text
 bucket:  0 ─────────── 9 ─────────────────────── 49 ───────────────────── 99
 10%  :   [  in  ]
 50%  :   [          in                          ]
 100% :   [                              in                                 ]
```

- A device's bucket for an update never changes. It won't flip back and forth.
- Raising the percentage only adds devices. Everyone who had it keeps it.
- Each update has its own buckets, so the same users aren't always first.
- Devices outside the rollout **fall through** to the newest older update they qualify for.
- Requests without a client id only get updates at 100%.

## Lowering or pausing a rollout

You can set a lower percentage, including `0`:

```sh
npx tidepush rollout <groupId> 0
```

New devices stop getting the update. But **devices that already downloaded it keep it**: they'd fall through to an older update, and `expo-updates` never moves to an older update. To actually take it away from them, [roll it back](/guides/rollbacks).

## A good routine

1. Publish to `staging` and test.
2. Promote to `production` at 5–10%: `npx tidepush promote <id> --to production --rollout 10`.
3. Wait a day. Watch your crash reporting and the dashboard's adoption numbers.
4. Go to 50%, then 100%.
5. If anything looks wrong, roll back.

::: info Users only count once they relaunch
Remember a device needs two cold starts to run an update. Adoption after a few hours is mostly people who opened the app twice. The dashboard counts devices by the update they **report running**.
:::

::: warning Partial rollouts and rollback
When you roll back, Tidepush republishes the most recent previous update that was at **100%**. A previous update that was still partial is not a rollback target. Finish or roll back one rollout before starting the next.
:::
