#!/bin/bash

set -e

APP_NAME="almaren-chat"
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

export PORT

if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs --env production --update-env
else
  pm2 start ecosystem.config.cjs --env production --update-env
fi

pm2 save
