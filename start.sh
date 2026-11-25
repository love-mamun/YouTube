#!/bin/sh
set -eu

# Create/update PostgreSQL tables from the Drizzle schema before serving requests.
pnpm --filter @workspace/db run push

exec node --enable-source-maps artifacts/api-server/dist/index.mjs
