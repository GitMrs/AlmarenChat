#!/bin/bash

set -Eeuo pipefail

ENV_FILE="${ENV_FILE:-.env.production}"
PORT="${PORT:-8001}"
BUILD_DIR=".next.deploy"
BACKUP_DIR=".next.previous"
PM2_CONFIG="ecosystem.config.cjs"
PM2_APPS=(almaren-chat almaren-chat-worker almaren-chat-qq)
SERVICES_STOPPED=0

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: env file not found: $ENV_FILE"
  echo "Create $ENV_FILE first, or run ENV_FILE=.env ./deploy-pm2.sh"
  exit 1
fi

set -a
. "$ENV_FILE"
set +a

if [ -z "${DATABASE_URL:-}" ] || [[ "$DATABASE_URL" == file:/app/* ]]; then
  export DATABASE_URL="file:./data/dev.db"
fi

restart_services() {
  set +e
  pm2 startOrReload "$PM2_CONFIG" --env production --update-env
  pm2 save
  set -e
}

rollback_after_failure() {
  local status=$?
  if [ "$SERVICES_STOPPED" -eq 1 ]; then
    echo "Deployment failed; restoring service availability..."
    restart_services
  fi
  exit "$status"
}
trap rollback_after_failure EXIT

if command -v git >/dev/null 2>&1 && [ -d .git ]; then
  echo "Updating code..."
  git pull --ff-only
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

echo "Generating Prisma client..."
yarn prisma generate

if [ -e "$BUILD_DIR" ]; then
  rm -rf "$BUILD_DIR"
fi
if [ -e "$BACKUP_DIR" ]; then
  echo "Error: stale rollback directory exists: $BACKUP_DIR"
  echo "Inspect it before deploying; remove it only after confirming the previous deployment is healthy."
  exit 1
fi

echo "Building app in an isolated directory..."
NEXT_DIST_DIR="$BUILD_DIR" yarn build

echo "Backing up SQLite database before schema changes..."
yarn db:backup

echo "Stopping PM2 services for SQLite migration..."
for app in "${PM2_APPS[@]}"; do
  if pm2 describe "$app" >/dev/null 2>&1; then
    pm2 stop "$app"
  fi
done
SERVICES_STOPPED=1

echo "Preparing Prisma migration history..."
node scripts/upgrade-agent-runtime.mjs --prepare-prisma
echo "Applying database migrations..."
yarn prisma migrate deploy
echo "Applying compatibility data upgrades..."
yarn db:upgrade-agent-runtime

echo "Switching to the verified build..."
if [ -d .next ]; then
  mv .next "$BACKUP_DIR"
fi
mv "$BUILD_DIR" .next

echo "Starting with PM2..."
export PORT
if ! pm2 startOrReload "$PM2_CONFIG" --env production --update-env; then
  echo "New build failed to start; rolling back the previous build..."
  rm -rf .next
  if [ -d "$BACKUP_DIR" ]; then
    mv "$BACKUP_DIR" .next
  fi
  restart_services
  SERVICES_STOPPED=0
  exit 1
fi

pm2 save
SERVICES_STOPPED=0
rm -rf "$BACKUP_DIR"
trap - EXIT

echo ""
echo "PM2 deployment complete."
echo "Web logs: pm2 logs almaren-chat"
echo "Worker logs: pm2 logs almaren-chat-worker"
echo "QQ Bot logs: pm2 logs almaren-chat-qq"
echo "Status: pm2 status"
echo "URL: http://localhost:$PORT"
