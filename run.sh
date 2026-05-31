#!/usr/bin/env bash
# Thin wrapper — all logic lives in scripts/run-sites.js
set -euo pipefail
node scripts/run-sites.js "$@"
