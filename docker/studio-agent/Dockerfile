# Studio Coding Agent 沙箱镜像（宿主 + pi 运行时）
#
# 构建：
#   docker build -t almaren/studio-agent:0.1.0 docker/studio-agent
#
# 该镜像只包含 pi CLI 与最小运行时，不含项目源码、不含任何密钥。
# 容器启动时由宿主注入：
#   - /workspace  用户工作区（RW）
#   - /pi-config  pi 配置目录（RW，仅含 models.json）
#   - 环境变量   仅模型网关所需 key/baseUrl

FROM node:22-bookworm-slim

ARG PI_VERSION=0.85.1

ENV NODE_ENV=production \
    PI_CODING_AGENT_DIR=/pi-config \
    HOME=/tmp \
    NPM_CONFIG_UPDATE_NOTIFIER=false

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git ripgrep python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/pi

RUN npm init -y >/dev/null 2>&1 \
  && npm install --omit=dev --no-audit --no-fund "@earendil-works/pi-coding-agent@${PI_VERSION}" \
  && npm cache clean --force

RUN mkdir -p /workspace /pi-config /opt/studio \
  && chown -R 1000:1000 /workspace /pi-config

COPY extensions/approval.ts /opt/studio/approval.ts

WORKDIR /workspace

ENTRYPOINT ["node", "/opt/pi/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"]
