# 多階段構建 Dockerfile for Stellar Backend
# Stage 1: 構建階段
FROM node:18-alpine AS builder

# 設置工作目錄
WORKDIR /app

# 複製 package files
COPY package*.json ./

# 安裝所有依賴（包括 devDependencies）
RUN npm install

# 複製源碼
COPY . .

# 構建 TypeScript
RUN npx tsc

# Stage 2: 生產階段
FROM node:18-alpine AS production

# 安裝 dumb-init 用於正確處理信號
RUN apk add --no-cache dumb-init

# 創建非 root 用戶
RUN addgroup -g 1001 -S nodejs && \
    adduser -S stellar -u 1001

# 設置工作目錄
WORKDIR /app

# 從構建階段複製 package files
COPY package*.json ./

# 只安裝生產依賴
RUN npm ci --only=production && npm cache clean --force

# 從構建階段複製構建結果
COPY --from=builder /app/dist ./dist

# 複製其他必要文件
COPY --from=builder /app/.dockerignore ./

# 設置文件權限
RUN chown -R stellar:nodejs /app
USER stellar

# 暴露端口
EXPOSE 8080

# 設置環境變數
ENV NODE_ENV=production
ENV PORT=8080

# 健康檢查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node dist/src/healthcheck.js || exit 1

# 使用 dumb-init 作為 PID 1，正確處理信號
ENTRYPOINT ["dumb-init", "--"]

# 啟動應用
CMD ["node", "dist/src/server.js"]