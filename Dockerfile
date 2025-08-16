# Build 階段
FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY tsconfig.json ./
ENV CI=true
RUN npm install
COPY . .
RUN npm run build

# Production 階段
FROM node:24-alpine AS production
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production --ignore-scripts
COPY --from=builder /app/dist ./dist
CMD ["node", "dist/server.js"]