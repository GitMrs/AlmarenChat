#!/bin/bash

# almare-chat 快速启动脚本（不重新构建镜像）

set -e

IMAGE_NAME="almare-chat"

echo "⚡ 快速启动（不构建镜像）..."

# 检查镜像是否存在
if ! docker images ${IMAGE_NAME}:latest --format "{{.Repository}}:{{.Tag}}" | grep -q "${IMAGE_NAME}:latest"; then
  echo "❌ 错误: 镜像 ${IMAGE_NAME}:latest 不存在"
  echo "💡 请先运行 ./deploy.sh 构建镜像"
  exit 1
fi

# 停止并删除旧容器
echo "🛑 停止旧容器..."
docker stop ${IMAGE_NAME} 2>/dev/null || true
echo "🗑️  删除旧容器..."
docker rm ${IMAGE_NAME} 2>/dev/null || true

# 启动新容器（使用 latest 镜像）
echo "🔥 启动新容器..."
docker run -d \
  --name ${IMAGE_NAME} \
  -p 8001:3000 \
  --env-file .env \
  -v "$(pwd)/public/uploads:/app/public/uploads" \
  --restart unless-stopped \
  ${IMAGE_NAME}:latest

echo ""
echo "✅ 容器已启动！"
echo ""
echo "📊 查看日志: docker logs -f ${IMAGE_NAME}"
echo "🌐 访问地址: http://localhost:8001"
echo ""
echo "💡 提示:"
echo "   - 修改 .env 后重新运行此脚本即可"
echo "   - 如需重新构建，请运行 ./deploy.sh"
