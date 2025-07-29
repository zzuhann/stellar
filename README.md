# Stellar Backend - 台灣生咖地圖 API

台灣生咖地圖網站的後端 API 服務，提供藝人管理、生咖活動投稿與審核功能。

## 功能特色

- 🎭 藝人管理系統（用戶投稿 + 管理員審核）
- ☕ 生咖活動 CRUD 操作
- 🗺️ 地圖標記資料提供
- 👤 Firebase Auth 用戶認證
- 🔐 角色權限控制（一般用戶/管理員）
- ⚡ 自動清理過期活動

## 技術架構

- **框架**: Node.js + Express + TypeScript
- **資料庫**: Firebase Firestore
- **認證**: Firebase Auth
- **檔案儲存**: Firebase Storage

## 快速開始

### 1. 安裝依賴
```bash
npm install
```

### 2. 設定環境變數
複製 `.env.example` 為 `.env` 並填入您的 Firebase 設定：
```bash
cp .env.example .env
```

### 3. Firebase 設定
1. 到 [Firebase Console](https://console.firebase.google.com) 建立專案
2. 啟用 Firestore Database、Authentication、Storage
3. 下載服務帳戶金鑰 JSON 檔案
4. 將金鑰內容填入 `.env` 檔案

### 4. 啟動開發伺服器
```bash
npm run dev
```

伺服器將在 `http://localhost:3001` 啟動。

## API 端點

### 藝人管理
- `GET /api/artists` - 獲取所有已審核藝人
- `POST /api/artists` - 新增藝人（需登入）
- `GET /api/artists/pending` - 獲取待審核藝人（管理員）
- `PATCH /api/artists/:id/review` - 審核藝人（管理員）
- `DELETE /api/artists/:id` - 刪除藝人（管理員）

### 生咖活動
- `GET /api/events` - 獲取所有進行中活動
- `GET /api/events/search` - 搜尋活動
- `GET /api/events/:id` - 獲取單一活動詳情
- `POST /api/events` - 新增活動（需登入）
- `GET /api/events/admin/pending` - 獲取待審核活動（管理員）
- `PATCH /api/events/:id/review` - 審核活動（管理員）
- `DELETE /api/events/:id` - 刪除活動（創建者/管理員）

### 其他
- `GET /api/health` - 健康檢查

## 部署指令

```bash
# 建置專案
npm run build

# 啟動正式環境
npm start
```

## 資料庫結構

### Artists Collection
```typescript
{
  id: string
  stageName: string          // 藝名（主要顯示）
  realName?: string          // 本名（可選）
  birthday?: string          // 生日 (YYYY-MM-DD 格式)
  profileImage?: string      // 照片 URL
  status: 'pending' | 'approved' | 'rejected'
  createdBy: string
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

### Coffee Events Collection
```typescript
{
  id: string
  artistId: string
  title: string
  description: string
  location: {
    address: string
    coordinates: { lat: number, lng: number }
  }
  datetime: {
    start: Timestamp
    end: Timestamp
  }
  socialMedia: {
    instagram?: string
    twitter?: string
    threads?: string
  }
  images: string[]
  supportProvided?: boolean
  requiresReservation?: boolean
  onSiteReservation?: boolean
  amenities?: string[]
  status: 'pending' | 'approved' | 'rejected'
  isDeleted: boolean
  createdBy: string
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

## 開發說明

- 使用 TypeScript 進行開發
- 遵循 RESTful API 設計原則
- 實作軟刪除機制
- 支援 CORS 跨域請求
- 包含完整的錯誤處理

## License

ISC
