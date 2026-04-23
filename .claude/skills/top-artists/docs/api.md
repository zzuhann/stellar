# Top Artists - API 規格

> 新增、修改 endpoint 時請更新此文件

---

## GET /api/artists/top

取得擁有最多即將到來活動的藝人列表。

**Auth**：不需要

**Cache TTL**：360 分鐘（6 小時）

### Request

```
GET /api/artists/top?limit=10
```

| 參數 | 位置 | 預設值 | 說明 |
|------|------|--------|------|
| `limit` | query | `10` | 最多回傳幾筆，上限 `50` |

### Response

```json
[
  {
    "id": "artist-id",
    "stageName": "藝名",
    "stageNameZh": "中文藝名",
    "groupNames": ["團名1", "團名2"],
    "profileImage": "https://...",
    "birthday": "1990-01-01",
    "status": "approved",
    "upcomingEventCount": 5,
    "createdAt": { "_seconds": ..., "_nanoseconds": ... },
    "updatedAt": { "_seconds": ..., "_nanoseconds": ... }
  }
]
```

**篩選條件**：
- 活動：`status == 'approved'` 且 `datetime.end >= now`
- 藝人：`status == 'approved'`

**排序**：`upcomingEventCount desc`

### Error Response

| 狀況 | Status | Body |
|------|--------|------|
| limit 參數無效 | `400 Bad Request` | `{ "error": "Invalid limit parameter" }` |
| 伺服器錯誤 | `500 Internal Server Error` | `{ "error": "..." }` |

---

## 實作狀態

| Endpoint | 狀態 |
|----------|------|
| `GET /artists/top` | Done |
