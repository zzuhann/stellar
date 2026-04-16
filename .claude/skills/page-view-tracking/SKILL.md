---
name: page-view-tracking
description: 活動瀏覽量追蹤 - 後端實作規格
---

# 活動瀏覽量追蹤 - 後端

> **重要**：新增、修改實作時，請同步更新：
> - [docs/api.md](./docs/api.md)

## 設計原則

- **Atomic Write**：使用 `FieldValue.increment(1)` 避免 race condition，不可 read-then-write
- **Dedup 在後端**：前端 dedup 不可信，後端用 in-memory cache 做 per-IP + per-eventId 去重
- **排行榜走 Cache**：trending query 不走即時 Firestore，用 cache TTL 控制更新頻率
- **Fire-and-forget 回應**：view endpoint 回 `204 No Content`，不阻塞使用者

---

## 資料結構

### CoffeeEvent（`src/models/types.ts`）

```ts
viewCount?: number  // optional，舊資料無此欄位時視為 0
```

---

## Dedup 策略

使用現有 `cache` utility 做 in-memory rate limiting：

```
cache key: view_dedup:{ip}:{eventId}
TTL: 60 分鐘
```

流程：
1. 取得 request IP（`req.ip` 或 `x-forwarded-for`）
2. 檢查 cache key 是否存在
3. 存在 → 回 `204`，不計算
4. 不存在 → set cache key + `FieldValue.increment(1)`

---

## Service 方法

### `incrementViewCount(eventId: string): Promise<void>`

- 直接對 Firestore 文件做 `FieldValue.increment(1)`
- 不走 cache（寫入本身就是原子操作）
- 若文件不存在或 viewCount 欄位不存在，Firestore 會自動建立並設為 1

### `getTrendingEvents(limit: number): Promise<CoffeeEvent[]>`

- 查詢條件：`status == 'approved' AND end >= now`
- 排序：`viewCount desc`
- 使用 `cache.getWithLock` 包裹
- cache key: `events:trending:{limit}`
- TTL: 360 分鐘（6 小時）

---

## API 規格

詳見 [docs/api.md](./docs/api.md)

---

## 注意事項

1. **路由順序**：`GET /trending` 必須放在 `GET /:id` 之前，否則 Express 會將 `trending` 視為 eventId
2. **viewCount 排序**：Firestore 對 `undefined` 欄位排序時，該文件會排在最後，新活動自然不影響排行
3. **cache invalidation**：increment viewCount 時不需主動清 trending cache，讓 TTL 自然過期即可
4. **不需要 auth**：view 和 trending 都是公開 endpoint

---

## 相關檔案

- `docs/api.md` - API endpoint 規格
- `src/models/types.ts` - CoffeeEvent type（加 viewCount）
- `src/services/eventService.ts` - incrementViewCount, getTrendingEvents
- `src/controllers/eventController.ts` - recordView, getTrendingEvents
- `src/routes/eventRoutes.ts` - 路由註冊
- `src/utils/cache.ts` - 現有 cache utility（dedup 使用）
