#!/bin/bash

set -Eeuo pipefail

ENV_FILE="${ENV_FILE:-.env.production}"
PORT="${PORT:-8001}"
BUILD_DIR=".next.deploy"
BACKUP_DIR=".next.previous"
PM2_CONFIG="ecosystem.config.cjs"
PM2_APPS=(almaren-chat almaren-chat-worker almaren-chat-qq)
SERVICES_STOPPED=0
MIGRATION_FAILED=0
LOCK_FILE="${DEPLOY_LOCK_FILE:-/tmp/almaren-chat-deploy.lock}"
HEALTH_URL="${HEALTH_URL:-}"
DATABASE_BACKUP_RESULT=""

if ! command -v flock >/dev/null 2>&1; then
  echo "Error: flock is required for serialized deployments"
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "Error: curl is required for the post-deploy health check"
  exit 1
fi

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Error: another deployment is already running (lock: $LOCK_FILE)"
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: env file not found: $ENV_FILE"
  echo "Create $ENV_FILE first, or run ENV_FILE=.env ./deploy-pm2.sh"
  exit 1
fi

set -a
. "$ENV_FILE"
set +a

if [ -z "${DATABASE_URL:-}" ]; then
  echo "Error: DATABASE_URL is required in $ENV_FILE"
  exit 1
fi
if [[ "$DATABASE_URL" != file:* ]]; then
  echo "Error: production deployment currently requires a SQLite file DATABASE_URL"
  exit 1
fi

restart_services() {
  if [ ! -f .next/BUILD_ID ]; then
    echo "CRITICAL: cannot start PM2 services because .next/BUILD_ID is missing"
    echo "Build the application successfully before restoring PM2 services."
    return 1
  fi
  if ! pm2 startOrReload "$PM2_CONFIG" --env production --update-env; then
    echo "CRITICAL: failed to restore PM2 services"
    return 1
  fi
  if ! pm2 save; then
    echo "CRITICAL: PM2 services started but pm2 save failed"
    return 1
  fi
}

rollback_after_failure() {
  local status=$?
  if [ "$SERVICES_STOPPED" -eq 1 ]; then
    if [ "$MIGRATION_FAILED" -eq 1 ]; then
      echo "CRITICAL: database migration failed; PM2 services remain stopped to prevent a restart loop."
      echo "After recovering the migration, run: pm2 startOrReload $PM2_CONFIG --env production --update-env"
    else
      echo "Deployment failed; restoring service availability..."
      if ! restart_services; then
        echo "CRITICAL: deployment failed and service restoration failed"
      fi
    fi
    echo "Database backups are retained under ${DATABASE_BACKUP_DIR:-data/backups}"
  fi
  exit "$status"
}
trap rollback_after_failure EXIT

wait_for_health() {
  local health_url="${HEALTH_URL:-http://127.0.0.1:${PORT}/}"
  local attempt
  echo "Checking application health at $health_url..."
  for attempt in {1..12}; do
    if curl --fail --silent --show-error --max-time 3 "$health_url" >/dev/null; then
      echo "Application health check passed."
      return 0
    fi
    sleep 2
  done
  echo "Application health check failed after 12 attempts."
  return 1
}

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

if [ -d ".next/cache" ]; then
  echo "Reusing Next.js build cache..."
  mkdir -p "$BUILD_DIR"
  cp -a .next/cache "$BUILD_DIR/cache"
fi

echo "Building app in an isolated directory..."
NEXT_DIST_DIR="$BUILD_DIR" yarn build
if [ ! -f "$BUILD_DIR/BUILD_ID" ]; then
  echo "Error: Next.js build completed without $BUILD_DIR/BUILD_ID"
  exit 1
fi

echo "Backing up SQLite database before schema changes..."
DATABASE_BACKUP_RESULT="$(yarn db:backup)"
echo "$DATABASE_BACKUP_RESULT"

echo "Stopping PM2 services for SQLite migration..."
for app in "${PM2_APPS[@]}"; do
  if pm2 describe "$app" >/dev/null 2>&1; then
    pm2 stop "$app"
  fi
done
SERVICES_STOPPED=1

echo "Preparing Prisma migration history..."
if ! node scripts/upgrade-agent-runtime.mjs --prepare-prisma; then
  MIGRATION_FAILED=1
  exit 1
fi
echo "Applying database migrations..."
if ! yarn prisma migrate deploy; then
  MIGRATION_FAILED=1
  exit 1
fi
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
  if ! restart_services; then
    echo "CRITICAL: start-failure rollback failed to restore PM2 services"
  fi
  SERVICES_STOPPED=0
  exit 1
fi

if ! wait_for_health; then
  echo "New build is not healthy; rolling back the previous build..."
  rm -rf .next
  if [ -d "$BACKUP_DIR" ]; then
    mv "$BACKUP_DIR" .next
  fi
  if ! restart_services; then
    echo "CRITICAL: health-check rollback failed to restore PM2 services"
  fi
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
