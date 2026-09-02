#!/bin/bash

set -e

ENV_FILE="${ENV_FILE:-.env.production}"
PORT="${PORT:-8001}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: env file not found: $ENV_FILE"
  exit 1
fi

set -a
. "$ENV_FILE"
set +a

if [ -z "$DATABASE_URL" ] || [[ "$DATABASE_URL" == file:/app/* ]]; then
  export DATABASE_URL="file:./data/dev.db"
fi

echo "Verifying SQLite native bindings..."
yarn db:verify-native

echo "Upgrading Agent Runtime schema..."
yarn db:upgrade-agent-runtime

export PORT
pm2 startOrReload ecosystem.config.cjs --env production --update-env

pm2 save

echo "PM2 services started: almaren-chat, almaren-chat-worker"
echo "Status: pm2 status"
