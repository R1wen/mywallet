#!/bin/sh
set -e
if [ "$RUN_MIGRATIONS" = "1" ]; then
  echo "Applying database migrations..."
  node ./migrate.mjs
fi
exec node server.js
