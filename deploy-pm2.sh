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

missing_build_tools=()
for command_name in python3 make g++; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    missing_build_tools+=("$command_name")
  fi
done

if [ "${#missing_build_tools[@]}" -gt 0 ]; then
  echo "Error: native module build tools are missing: ${missing_build_tools[*]}"
  echo "Debian/Ubuntu: sudo apt-get update && sudo apt-get install -y python3 make g++"
  echo "RHEL/Rocky/AlmaLinux: sudo dnf install -y python3 make gcc-c++"
  exit 1
fi

echo "Installing dependencies..."
ONNXRUNTIME_NODE_INSTALL=skip yarn install --frozen-lockfile

echo "Verifying SQLite native bindings..."
if ! yarn db:verify-native; then
  SQLITE_NATIVE_DIR="node_modules/@prisma/adapter-better-sqlite3/node_modules/better-sqlite3"
  if [ ! -d "$SQLITE_NATIVE_DIR" ]; then
    echo "Error: Prisma SQLite driver not found: $SQLITE_NATIVE_DIR"
    exit 1
  fi

  echo "SQLite native bindings are missing. Rebuilding only Prisma's SQLite driver..."
  npm run install --prefix "$SQLITE_NATIVE_DIR"
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
echo "QQ Bot logs: pm2 logs almaren-chat-qq"
echo "Status: pm2 status"
echo "URL: http://localhost:$PORT"
