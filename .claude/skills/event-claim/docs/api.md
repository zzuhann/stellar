# Event Claim - API 規格

> 新增、修改 endpoint 時請更新此文件

---

## GET /api/users/me/claimed-events

取得當前用戶已認領（驗證成功）的活動列表。

**Auth**：需要登入（`authenticateToken`）

### Request

```
GET /api/users/me/claimed-events?page=1&limit=20
```

| 參數 | 位置 | 必填 | 預設 | 說明 |
|------|------|------|------|------|
| `page` | query | ✗ | 1 | 頁碼 |
| `limit` | query | ✗ | 20 | 每頁數量（最大 100） |

### Response

```json
{
  "events": [
    {
      "id": "event-id",
      "title": "活動標題",
      "artists": [...],
      "datetime": { "start": ..., "end": ... },
      "location": { "name": "...", "address": "..." },
      "mainImage": "...",
      "verifiedOrganizers": [
        {
          "userId": "user-id",
          "platform": "threads",
          "username": "npclab",
          "verifiedAt": { "_seconds": ..., "_nanoseconds": ... }
        }
      ]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 5,
    "totalPages": 1
  }
}
```

| 狀況 | Status |
|------|--------|
| 成功 | `200 OK` |
| 未登入 | `401 Unauthorized` |
| 伺服器錯誤 | `500 Internal Server Error` |

### 實作細節

**篩選條件**：
- `status == 'approved'`
- `verifiedOrganizers` 包含當前用戶的 `userId`

**排序**：依 `verifiedAt` 時間排序（最新認領在前）

**技術說明**：
- 由於 Firestore `array-contains` 無法直接查詢物件屬性，採用記憶體過濾方式
- 查詢所有 `status === 'approved'` 的活動，過濾出 `verifiedOrganizers?.some(o => o.userId === userId)`

---

## 相關檔案

| 檔案 | 類型 | 說明 |
|------|------|------|
| `src/models/types.ts` | 修改 | 新增 `UserClaimedEventsListResponse` |
| `src/services/eventService.ts` | 修改 | 新增 `getUserClaimedEventsPaginated` 方法 |
| `src/controllers/userController.ts` | 修改 | 新增 `getMyClaimedEvents` 方法 |
| `src/routes/userRoutes.ts` | 修改 | 新增路由 `GET /me/claimed-events` |
