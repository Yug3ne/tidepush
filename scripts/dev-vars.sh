#!/usr/bin/env bash
# Writes apps/server/.dev.vars (gitignored) for `wrangler dev`.
# Usage: scripts/dev-vars.sh [path/to/private-key.pem]
# Without a key path, generates a throwaway signing key for local testing only.
set -euo pipefail
cd "$(dirname "$0")/.."
key="${1:-}"
if [[ -z "$key" ]]; then
  key="$(mktemp)"
  openssl genrsa -traditional -out "$key" 2048 2>/dev/null || openssl genrsa -out "$key" 2048 2>/dev/null
  echo "Generated a throwaway signing key. A real app needs the key matching its certificate." >&2
fi
[[ -f "$key" ]] || { echo "No private key at $key" >&2; exit 1; }
setup_token="setup-$(openssl rand -hex 24)"
# Keep an existing key-encryption key: replacing it would make every app key
# already in the local database impossible to decrypt.
kek="$(sed -n 's/^KEY_ENCRYPTION_KEY="\(.*\)"$/\1/p' apps/server/.dev.vars 2>/dev/null || true)"
[[ -n "$kek" ]] || kek="$(openssl rand -base64 32)"
{
  printf 'CODE_SIGNING_PRIVATE_KEY="%s"\n' "$(cat "$key")"
  printf 'SETUP_TOKEN="%s"\n' "$setup_token"
  printf 'KEY_ENCRYPTION_KEY="%s"\n' "$kek"
} > apps/server/.dev.vars
chmod 600 apps/server/.dev.vars
echo "Wrote apps/server/.dev.vars"
echo "Open http://localhost:8787/setup and use this setup token: $setup_token"
