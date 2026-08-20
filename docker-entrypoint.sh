#!/bin/sh
set -e

# Fixes the ownership of the output root on every start. Bind-mount sources
# that the Docker daemon auto-creates are root-owned, but the app runs as
# 'node' (uid 1000) — without this, SQLite can't open its database.
BASE_DIR="${BASE_DIR:-/app/data}"
mkdir -p "$BASE_DIR"
chown -R node:node "$BASE_DIR" 2>/dev/null || true

# Drop to the 'node' user and run the CMD (node dist/main.js).
exec setpriv --reuid=node --regid=node --init-groups "$@"