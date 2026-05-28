#!/bin/bash

# Joyadata Portal 生产部署脚本（版本管理 + 自动清理）
git pull
set -e  # 遇到错误立即退出

# 配置
IMAGE_NAME="joyadata-portal"
KEEP_VERSIONS=3  # 保留最近3个版本

# 生成版本标签（时间戳）
VERSION=$(date +%Y%m%d-%H%M%S)
echo "📦 构建版本: ${IMAGE_NAME}:${VERSION}"

# 1. 构建新镜像
echo "🚀 开始构建镜像..."
docker build -t ${IMAGE_NAME}:${VERSION} .


# 2. 给新镜像打上 latest 标签
echo "🏷️  更新 latest 标签..."
docker tag ${IMAGE_NAME}:${VERSION} ${IMAGE_NAME}:latest

# 3. 停止并删除旧容器
echo "🛑 停止并删除旧容器..."
docker stop ${IMAGE_NAME} 2>/dev/null || true
docker rm ${IMAGE_NAME} 2>/dev/null || true

# 4. 确保 uploads 目录存在并有写权限
echo "📁 创建并设置 uploads 目录权限..."
mkdir -p public/uploads/images public/uploads/documents
chmod -R 777 public/uploads

# 5. 启动新容器
echo "🔥 启动新容器..."
docker run -d \
  --name ${IMAGE_NAME} \
  -p 3000:3000 \
  --env-file .env.production \
  -v "$(pwd)/public/uploads:/app/public/uploads" \
  --restart unless-stopped \
  ${IMAGE_NAME}:${VERSION}

# 6. 清理 dangling 镜像
echo "🧹 清理旧的镜像标签..."
docker image prune -f

# 7. 清理旧版本（保留最近N个版本）
echo "🗑️  清理旧版本（保留最近 ${KEEP_VERSIONS} 个）..."
docker images ${IMAGE_NAME} --format "{{.Tag}}" | \
  grep -E "^[0-9]{8}-[0-9]{6}$" | \
  sort -r | \
  tail -n +$((KEEP_VERSIONS + 1)) | \
  while read tag; do
    echo "  删除: ${IMAGE_NAME}:${tag}"
    docker rmi ${IMAGE_NAME}:${tag} 2>/dev/null || true
  done

echo ""
echo "✅ 部署完成！"
echo ""
echo "📊 当前运行的镜像: ${IMAGE_NAME}:${VERSION}"
echo "📋 查看所有版本: docker images ${IMAGE_NAME}"
echo "📊 查看日志: docker logs -f ${IMAGE_NAME}"
echo "🌐 访问地址: http://localhost:3000"
echo ""
echo "💡 回滚到上一个版本:"
echo "   docker stop ${IMAGE_NAME} && docker rm ${IMAGE_NAME}"
echo "   PREV_VERSION=\$(docker images ${IMAGE_NAME} --format '{{.Tag}}' | grep -E '^[0-9]{8}-[0-9]{6}\$' | sort -r | sed -n '2p')"
echo "   docker run -d --name ${IMAGE_NAME} -p 3000:3000 --env-file .env.production -v \$(pwd)/public/uploads:/app/public/uploads --restart unless-stopped ${IMAGE_NAME}:\$PREV_VERSION"
