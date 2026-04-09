# Page View Tracking - API 規格

> 新增、修改 endpoint 時請更新此文件

---

## POST /api/events/:id/view

記錄活動瀏覽量。

**Auth**：不需要

**Dedup**：同一 IP 對同一 eventId，60 分鐘內只計算一次

### Request

```
POST /api/events/:id/view
```

| 參數 | 位置 | 說明 |
|------|------|------|
| `id` | path | 活動 ID |

### Response

| 狀況 | Status |
|------|--------|
| 計算成功 | `204 No Content` |
| 重複請求（dedup） | `204 No Content` |
| 活動不存在 | `404 Not Found` |
| 伺服器錯誤 | `500 Internal Server Error` |

> 不論是否實際計算，皆回 `204`，前端不需要判斷結果。

---

## GET /api/events/trending

取得瀏覽量排行的活動列表。

**Auth**：不需要

**Cache TTL**：360 分鐘（6 小時）

### Request

```
GET /api/events/trending?limit=10
```

| 參數 | 位置 | 預設值 | 說明 |
|------|------|--------|------|
| `limit` | query | `10` | 最多回傳幾筆，上限 `20` |

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
      "viewCount": 42
    }
  ],
  "total": 10
}
```

**篩選條件（query 層）**：
- `status == 'approved'`
- `end >= now`（包含進行中與即將開始）

**排序**：`viewCount desc`（viewCount 為 undefined 的文件排最後）

---

## 實作狀態

| Endpoint | 狀態 |
|----------|------|
| `POST /events/:id/view` | TODO |
| `GET /events/trending` | TODO |
