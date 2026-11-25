#!/bin/sh
set -eu

# Create/update PostgreSQL tables non-interactively before serving requests.
node lib/db/src/ensure-schema.mjs

# Start the local bgutil PO Token HTTP server for yt-dlp if compiled in the image.
BGUTIL_MAIN="${BGUTIL_SERVER_HOME:-/opt/bgutil-ytdlp-pot-provider/server}/build/main.js"
if [ -f "$BGUTIL_MAIN" ]; then
  echo "Starting bgutil PO Token HTTP server on 127.0.0.1:4416..."
  node "$BGUTIL_MAIN" --port 4416 >/tmp/bgutil-pot.log 2>&1 &
fi

exec node --enable-source-maps artifacts/api-server/dist/index.mjs
