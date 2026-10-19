#!/usr/bin/env bash
# Writes apps/server/.dev.vars and apps/web/.dev.vars (both gitignored) for `bun run dev`.
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
# The web app's session secret. Kept if there is one, so local sign-ins survive a rerun;
# any GitHub OAuth settings already in the file are kept too.
web_vars=apps/web/.dev.vars
auth_secret="$(sed -n 's/^BETTER_AUTH_SECRET="\(.*\)"$/\1/p' "$web_vars" 2>/dev/null || true)"
if [[ -z "$auth_secret" || "$auth_secret" == replace-with-* ]]; then
  auth_secret="$(openssl rand -base64 32)"
  others="$(grep -v '^BETTER_AUTH_SECRET=' "$web_vars" 2>/dev/null || true)"
  {
    printf 'BETTER_AUTH_SECRET="%s"\n' "$auth_secret"
    if [[ -n "$others" ]]; then printf '%s\n' "$others"; fi
  } > "$web_vars"
  chmod 600 "$web_vars"
  echo "Wrote $web_vars"
fi
echo "Run \`bun run dev\`, open http://localhost:3000/setup and use this setup token: $setup_token"
