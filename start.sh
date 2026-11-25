#!/bin/sh
set -eu

# Create/update PostgreSQL tables non-interactively before serving requests.
node lib/db/src/ensure-schema.mjs

exec node --enable-source-maps artifacts/api-server/dist/index.mjs
