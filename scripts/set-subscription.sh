#!/usr/bin/env bash
# Turns an org's subscription on or off, until payments exist.
# Usage: scripts/set-subscription.sh <orgId> on|off [--local]
# Without --local it changes the deployed (remote) database.
set -euo pipefail
cd "$(dirname "$0")/../apps/server"
org="${1:-}"; state="${2:-}"; where="${3:---remote}"
[[ "$org" =~ ^org_[a-z0-9_]+$ ]] || { echo "Usage: $0 <orgId> on|off [--local]" >&2; exit 1; }
case "$state" in on) value=1 ;; off) value=0 ;; *) echo "State must be on or off" >&2; exit 1 ;; esac
[[ "$where" == "--local" || "$where" == "--remote" ]] || { echo "Third argument must be --local" >&2; exit 1; }
npx wrangler d1 execute tidepush "$where" --command \
  "UPDATE orgs SET subscribed = $value, over_limit_since = NULL WHERE id = '$org'; SELECT id, name, subscribed FROM orgs WHERE id = '$org';"
