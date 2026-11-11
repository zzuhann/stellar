# Stellar Backend 部署指南

## 🐳 Docker 部署

### 快速開始

1. **構建映像**
```bash
docker build -t stellar-backend .
```

2. **運行容器**
```bash
docker run -d \
  --name stellar-backend \
  -p 8080:8080 \
  -e NODE_ENV=production \
  -e FIREBASE_PROJECT_ID=your_project_id \
  -e FIREBASE_PRIVATE_KEY="your_private_key" \
  -e FIREBASE_CLIENT_EMAIL=your_client_email \
  -e R2_ACCOUNT_ID=your_r2_account_id \
  -e R2_ACCESS_KEY_ID=your_access_key \
  -e R2_SECRET_ACCESS_KEY=your_secret_key \
  -e R2_BUCKET_NAME=your_bucket_name \
  -e R2_PUBLIC_URL=your_public_url \
  -e GOOGLE_MAPS_API_KEY=your_google_maps_key \
  -e FRONTEND_URL=https://your-frontend.com \
  stellar-backend
```

### 使用 Docker Compose

1. **創建 .env 文件**
```bash
cp .env.example .env
# 編輯 .env 文件，填入你的配置
```

2. **啟動服務**
```bash
# 生產模式
docker-compose up -d

# 開發模式
docker-compose --profile dev up -d stellar-dev
```

3. **查看日誌**
```bash
docker-compose logs -f stellar-backend
```

4. **停止服務**
```bash
docker-compose down
```

## 📊 健康檢查

容器包含內建的健康檢查：
- 端點：`GET /api/health`
- 間隔：30秒
- 超時：10秒
- 重試：3次

## 🔧 環境變數

### 必需的環境變數

| 變數名 | 描述 | 範例 |
|--------|------|------|
| `NODE_ENV` | 運行環境 | `production` |
| `PORT` | 服務端口 | `8080` |
| `FIREBASE_PROJECT_ID` | Firebase 專案 ID | `your-project-id` |
| `FIREBASE_PRIVATE_KEY` | Firebase 私鑰 | `"-----BEGIN PRIVATE KEY-----\n..."` |
| `FIREBASE_CLIENT_EMAIL` | Firebase 客戶端郵箱 | `firebase-adminsdk-...` |

### 可選的環境變數

| 變數名 | 描述 | 預設值 |
|--------|------|--------|
| `FRONTEND_URL` | 前端 URL（CORS） | `http://localhost:3000` |
| `GOOGLE_MAPS_API_KEY` | Google Maps API 金鑰 | - |
| `R2_ACCOUNT_ID` | Cloudflare R2 帳戶 ID | - |
| `R2_ACCESS_KEY_ID` | R2 存取金鑰 ID | - |
| `R2_SECRET_ACCESS_KEY` | R2 秘密存取金鑰 | - |
| `R2_BUCKET_NAME` | R2 儲存桶名稱 | - |
| `R2_PUBLIC_URL` | R2 公開 URL | - |

## 🚀 雲端部署

正式環境是 GCP Cloud Run（`stellar-backend`，asia-east1）：push 到 `main` 後由 Cloud Build Trigger 依 `cloudbuild.yaml` 建 image 並部署。環境變數設在 Cloud Run service 上，不在 repo。細節見 monorepo 的 `specs/_decisions/backend-deployment.md`。

## 🔍 故障排除

### 檢查容器狀態
```bash
docker ps
docker logs stellar-backend
```

### 進入容器調試
```bash
docker exec -it stellar-backend sh
```

### 檢查健康狀態
```bash
curl http://localhost:8080/api/health
```

### 常見問題

1. **Firebase 連接失敗**
   - 檢查 `FIREBASE_PRIVATE_KEY` 格式
   - 確保私鑰包含完整的 `-----BEGIN/END PRIVATE KEY-----`

2. **CORS 錯誤**
   - 檢查 `FRONTEND_URL` 設置
   - 確認前端域名在允許列表中

3. **端口衝突**
   - 修改 `-p 8080:8080` 中的第一個端口號

## 📈 監控和日誌

### 查看資源使用
```bash
docker stats stellar-backend
```

### 查看即時日誌
```bash
docker logs -f stellar-backend
```

### 導出日誌
```bash
docker logs stellar-backend > app.log 2>&1
```