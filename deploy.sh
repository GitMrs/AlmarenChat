#!/bin/bash

set -e

IMAGE_NAME="almaren-chat"
MIGRATOR_IMAGE_NAME="almaren-chat-migrator:tmp"
CONTAINER_NAME="almaren-chat"
HOST_PORT="${HOST_PORT:-8001}"
CONTAINER_PORT="3000"
ENV_FILE="${ENV_FILE:-.env.production}"
KEEP_VERSIONS="${KEEP_VERSIONS:-1}"

if [ ! -f "$ENV_FILE" ]; then
  echo "错误: 找不到环境变量文件 $ENV_FILE"
  echo "请在服务器创建 $ENV_FILE，至少包含 JWT_SECRET、apiKey"
  exit 1
fi

if command -v git >/dev/null 2>&1 && [ -d .git ]; then
  echo "更新代码..."
  git pull
fi

VERSION=$(date +%Y%m%d-%H%M%S)
echo "构建应用镜像: ${IMAGE_NAME}:${VERSION}"

docker build --target runner -t "${IMAGE_NAME}:${VERSION}" .
docker tag "${IMAGE_NAME}:${VERSION}" "${IMAGE_NAME}:latest"

echo "构建临时数据库同步镜像: ${MIGRATOR_IMAGE_NAME}"
docker build --target migrator -t "${MIGRATOR_IMAGE_NAME}" .

echo "停止旧容器..."
docker stop "${CONTAINER_NAME}" 2>/dev/null || true
docker rm "${CONTAINER_NAME}" 2>/dev/null || true

echo "准备持久化目录..."
mkdir -p data public/uploads/images public/uploads/documents
chmod -R 777 data public/uploads

echo "同步数据库结构..."
docker run --rm \
  --env-file "$ENV_FILE" \
  -e DATABASE_URL="file:/app/data/dev.db" \
  -v "$(pwd)/data:/app/data" \
  "${MIGRATOR_IMAGE_NAME}"

echo "删除临时数据库同步镜像..."
docker rmi "${MIGRATOR_IMAGE_NAME}" 2>/dev/null || true

echo "启动容器..."
docker run -d \
  --name "${CONTAINER_NAME}" \
  -p "${HOST_PORT}:${CONTAINER_PORT}" \
  --env-file "$ENV_FILE" \
  -e DATABASE_URL="file:/app/data/dev.db" \
  -v "$(pwd)/data:/app/data" \
  -v "$(pwd)/public/uploads:/app/public/uploads" \
  --restart unless-stopped \
  "${IMAGE_NAME}:${VERSION}"

echo "清理无用镜像..."
docker image prune -f

echo "保留最近 ${KEEP_VERSIONS} 个版本..."
docker images "${IMAGE_NAME}" --format "{{.Tag}}" | \
  grep -E "^[0-9]{8}-[0-9]{6}$" | \
  sort -r | \
  tail -n +"$((KEEP_VERSIONS + 1))" | \
  while read tag; do
    echo "删除: ${IMAGE_NAME}:${tag}"
    docker rmi "${IMAGE_NAME}:${tag}" 2>/dev/null || true
  done

echo ""
echo "部署完成"
echo "镜像: ${IMAGE_NAME}:${VERSION}"
echo "日志: docker logs -f ${CONTAINER_NAME}"
echo "访问: http://localhost:${HOST_PORT}"
