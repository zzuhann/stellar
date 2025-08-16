# Build 階段
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY tsconfig.json ./
RUN npm install --ignore-scripts
COPY . .
RUN npm run build

# Production 階段
FROM node:18-alpine AS production
WORKDIR /app
COPY package*.json ./
RUN npm install --ignore-scripts --only=production
COPY --from=builder /app/dist ./dist
CMD ["node", "dist/server.js"]