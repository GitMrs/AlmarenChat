#!/bin/bash

set -e

ENV_FILE="${ENV_FILE:-.env.production}"
PORT="${PORT:-8001}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: env file not found: $ENV_FILE"
  echo "Create $ENV_FILE first, or run ENV_FILE=.env ./deploy-pm2.sh"
  exit 1
fi

if command -v git >/dev/null 2>&1 && [ -d .git ]; then
  echo "Updating code..."
  git pull
fi

echo "Preparing directories..."
mkdir -p data public/uploads/images public/uploads/documents

echo "Installing dependencies..."
yarn install --frozen-lockfile

echo "Verifying SQLite native bindings..."
if ! yarn db:verify-native; then
  echo "SQLite native bindings are missing. Rebuilding dependencies..."
  yarn install --frozen-lockfile --force
  yarn db:verify-native
fi

echo "Syncing database schema..."
set -a
. "$ENV_FILE"
set +a

if [ -z "$DATABASE_URL" ] || [[ "$DATABASE_URL" == file:/app/* ]]; then
  export DATABASE_URL="file:./data/dev.db"
fi

yarn prisma generate
yarn db:upgrade-agent-runtime
yarn prisma db push

echo "Building app..."
yarn build

echo "Starting with PM2..."
export PORT
pm2 startOrReload ecosystem.config.cjs --env production --update-env

pm2 save

echo ""
echo "PM2 deployment complete."
echo "Web logs: pm2 logs almaren-chat"
echo "Worker logs: pm2 logs almaren-chat-worker"
echo "Status: pm2 status"
echo "URL: http://localhost:$PORT"
