# ============================================
# Stage 1: Dependencies
# ============================================
FROM node:22-alpine AS deps
RUN apk add --no-cache openssl
# 设置工作目录
WORKDIR /app

# 复制 package 文件
COPY package.json yarn.lock ./

# 复制 Prisma schema（Prisma 安装时可能需要）
COPY prisma/schema.prisma ./prisma/schema.prisma

# 安装依赖
RUN yarn install --frozen-lockfile

# ============================================
# Stage 2: Builder
# ============================================
FROM node:22-alpine AS builder
RUN apk add --no-cache openssl
# 设置工作目录
WORKDIR /app

# 从 deps 阶段复制 node_modules
COPY --from=deps /app/node_modules ./node_modules

# 复制public目录（在构建其他文件之前）
COPY public ./public

# 复制剩余文件
COPY . .

# 设置环境变量
ENV NEXT_TELEMETRY_DISABLED 1
ENV NODE_ENV production

# 生成 Prisma 客户端
RUN npx prisma generate

# 构建应用
RUN yarn build

# ============================================
# Stage 3: Runner
# ============================================
FROM node:22-alpine AS runner
RUN apk add --no-cache openssl
# 创建非 root 用户
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# 设置工作目录
WORKDIR /app

# 设置环境变量
ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1
ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

# 复制必要文件
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/healthcheck.js ./healthcheck.js

# 创建 uploads 目录并设置权限
RUN mkdir -p /app/public/uploads/images /app/public/uploads/documents && \
  chown -R nextjs:nodejs /app/public/uploads

# 复制 Next.js standalone 输出
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

# 切换到非 root 用户
USER nextjs

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node healthcheck.js || exit 1

# 启动应用
CMD ["node", "server.js"]
