#!/usr/bin/env bash
# Installs a (optionally pinned) version of the requested package manager.
# Usage: install-pm.sh <pm> [version]
set -euo pipefail

# Remove any corepack shims so the npm-global binaries we install below take
# precedence (otherwise `pnpm` could resolve to a stale corepack shim).
corepack disable 2>/dev/null || true

PM="$1"
VER="${2:-}"

case "$PM" in
  npm)
    if [[ -n "$VER" ]]; then npm install -g "npm@$VER"; else npm install -g npm@latest; fi
    ;;
  pnpm)
    if [[ -n "$VER" ]]; then npm install -g "pnpm@$VER"; else npm install -g pnpm@latest; fi
    ;;
  nub)
    if [[ -n "$VER" ]]; then npm install -g "@nubjs/nub@$VER"; else npm install -g @nubjs/nub@latest; fi
    ;;
  aube)
    if [[ -n "$VER" ]]; then npm install -g "@endevco/aube@$VER"; else npm install -g @endevco/aube@latest; fi
    ;;
  bun)
    if [[ -n "$VER" ]]; then
      # Pinned version: download the exact release binary.
      curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v${VER}/bun-linux-x64.zip" -o /tmp/bun.zip
      rm -rf /tmp/bun-extract && mkdir -p /tmp/bun-extract
      ( cd /tmp/bun-extract && unzip -o /tmp/bun.zip >/dev/null 2>&1 )
      mkdir -p "$HOME/.bun/bin"
      mv /tmp/bun-extract/bun-linux-x64/bun "$HOME/.bun/bin/bun"
      echo "$HOME/.bun/bin" >> "$GITHUB_PATH"
    else
      curl -fsSL https://bun.sh/install | bash
      echo "$HOME/.bun/bin" >> "$GITHUB_PATH"
    fi
    ;;
  *)
    echo "unknown pm: $PM" >&2
    exit 2
    ;;
esac

# Make sure the npm global bin dir is on PATH for this and later steps.
echo "$(npm prefix -g)/bin" >> "$GITHUB_PATH"
