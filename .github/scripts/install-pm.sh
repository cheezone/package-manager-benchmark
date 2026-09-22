#!/usr/bin/env bash
# Installs the LATEST version of the requested package manager.
set -euo pipefail

PM="$1"

case "$PM" in
  npm)
    npm install -g npm@latest
    ;;
  pnpm)
    npm install -g pnpm@latest
    ;;
  nub)
    npm install -g @nubjs/nub@latest
    ;;
  aube)
    npm install -g @endevco/aube@latest
    ;;
  yarn)
    corepack enable
    corepack prepare yarn@latest --activate
    ;;
  bun)
    curl -fsSL https://bun.sh/install | bash
    echo "$HOME/.bun/bin" >> "$GITHUB_PATH"
    ;;
  *)
    echo "unknown pm: $PM" >&2
    exit 2
    ;;
esac

# Make sure the npm global bin dir is on PATH for this and later steps.
echo "$(npm prefix -g)/bin" >> "$GITHUB_PATH"
