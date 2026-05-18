# stellar 後端規範

Express + Node.js + TypeScript 後端，負責提供 STELLAR 平台的 API。

## 本地開發

```bash
bun run dev    # port 3001，使用 --watch 熱重載
bun run build  # 編譯 TypeScript
```

---

## Firestore Collections

| Collection | 說明 |
|---|---|
| `artists` | 藝人資料（Artist interface） |
| `coffeeEvents` | 生咖活動資料（CoffeeEvent interface） |
| `users` | 使用者資料（User interface） |
| `userFavorites` | 使用者收藏 |
| `venues` | 場地資料 |

型別定義：`src/models/types.ts`

---

## 認證 Middleware

**`authenticateToken`**：驗證 Firebase ID Token，從 Firestore `users` 取得 role，注入 `req.user`。

```typescript
req.user = { uid: string, email: string, role: 'user' | 'admin' }
```

**`requireAdmin`**：在 `authenticateToken` 之後使用，限制管理員才能存取。

Token 放在 `Authorization: Bearer {token}` header。

---

## Config 模組（`src/config/`）

| 檔案 | 說明 |
|---|---|
| `firebase.ts` | Firestore（`db`）、Firebase Auth（`auth`）實例 |
| `r2-client.ts` | Cloudflare R2 圖片儲存 |
| `oauth.ts` | Threads OAuth 設定 |

---

## 目錄結構

```
src/
├── app.ts          # Express app、middleware 設定
├── server.ts       # 啟動入口
├── config/         # 外部服務初始化
├── routes/         # 路由（index.ts 統一 mount）
├── controllers/    # req/res 處理，薄層
├── services/       # 商業邏輯
├── middleware/     # auth.ts、validation.ts、upload.ts
├── models/
│   └── types.ts    # 全部型別定義
└── utils/          # cache.ts、firestoreTimeout.ts 等
```

---

## 環境變數

```env
# Firebase Admin SDK
FIREBASE_PROJECT_ID=
FIREBASE_PRIVATE_KEY=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY_ID=
FIREBASE_CLIENT_ID=
FIREBASE_AUTH_URI=
FIREBASE_TOKEN_URI=

# Cloudflare R2
# （R2 相關 key，見 src/config/r2-client.ts）

# Email（Resend）
RESEND_API_KEY=
EMAIL_WHITELIST=           # 逗號分隔，這些 email 不收通知
ADMIN_NOTIFY_EMAIL=

# OAuth
THREADS_APP_ID=
THREADS_APP_SECRET=
OAUTH_CALLBACK_BASE_URL=   # https://stellar.zeabur.app/api
OAUTH_STATE_SECRET=

# 其他
GOOGLE_MAPS_API_KEY=
FRONTEND_URL=              # https://www.stellar-zone.com
ADDITIONAL_CORS_ORIGINS=   # 額外允許的 CORS origin（逗號分隔）
PORT=3001
NODE_ENV=development
```

---

## 規格文件

功能設計規格在 `specs/features/` 下：

- `specs/features/events/design-backend.md` — CoffeeEvent 資料模型、API、快取策略
- `specs/features/event-claim/design-backend.md` — Threads OAuth 認領流程
- `specs/features/page-view-tracking/design-backend.md` — 瀏覽量追蹤
- `specs/features/top-artists/design-backend.md` — 熱門藝人 API
- `specs/features/email-notification/design-backend.md` — Email 通知

---

## 參考 Skills

- `~/.claude/skills/backend-patterns/` — Express Routes/Controllers/Services 分層、Zod validation、ApiError 模式
- `.claude/skills/cache/` — 本專案的 in-memory cache 使用規範
- `.claude/skills/testing/` — 單元測試規範（Jest + ts-jest）：檔案位置、Firestore mock 模式、Zod schema 測試
