#!/bin/bash

set -e

IMAGE_NAME="almaren-chat"
CONTAINER_NAME="almaren-chat"
HOST_PORT="${HOST_PORT:-3000}"
CONTAINER_PORT="3000"
ENV_FILE="${ENV_FILE:-.env.production}"

if [ ! -f "$ENV_FILE" ]; then
  echo "错误: 找不到环境变量文件 $ENV_FILE"
  echo "请先创建 $ENV_FILE，或用 ENV_FILE=.env ./star.sh 指定"
  exit 1
fi

if ! docker images "${IMAGE_NAME}:latest" --format "{{.Repository}}:{{.Tag}}" | grep -q "${IMAGE_NAME}:latest"; then
  echo "错误: 镜像 ${IMAGE_NAME}:latest 不存在"
  echo "请先运行 ./deploy.sh 构建镜像"
  exit 1
fi

echo "停止旧容器..."
docker stop "${CONTAINER_NAME}" 2>/dev/null || true
docker rm "${CONTAINER_NAME}" 2>/dev/null || true

echo "准备持久化目录..."
mkdir -p data public/uploads/images public/uploads/documents
chmod -R 777 data public/uploads

echo "启动容器..."
docker run -d \
  --name "${CONTAINER_NAME}" \
  -p "${HOST_PORT}:${CONTAINER_PORT}" \
  --env-file "$ENV_FILE" \
  -e DATABASE_URL="file:/app/data/dev.db" \
  -v "$(pwd)/data:/app/data" \
  -v "$(pwd)/public/uploads:/app/public/uploads" \
  --restart unless-stopped \
  "${IMAGE_NAME}:latest"

echo ""
echo "容器已启动"
echo "日志: docker logs -f ${CONTAINER_NAME}"
echo "访问: http://localhost:${HOST_PORT}"
