#!/usr/bin/env bash
# Prints node / npm / the benchmarked package-manager version.
set -euo pipefail

PM="$1"
echo "node: $(node --version)"
echo "npm:  $(npm --version)"
case "$PM" in
  npm)  echo "pm:   $(npm --version)" ;;
  pnpm) echo "pm:   $(pnpm --version)" ;;
  bun)  echo "pm:   $(bun --version)" ;;
  nub)  echo "pm:   $(nub --version)" ;;
  aube) echo "pm:   $(aube --version)" ;;
esac
