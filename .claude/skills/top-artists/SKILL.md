---
name: top-artists
description: 熱門藝人 API - 按即將到來活動數量排名
---

# 熱門藝人 API - 後端

> **重要**：新增、修改實作時，請同步更新：
> - [docs/api.md](./docs/api.md)

## 設計原則

- **只算未結束活動**：`datetime.end >= now` 且 `status == 'approved'`
- **只返回已審核藝人**：藝人 `status == 'approved'`
- **長 TTL 快取**：使用 6 小時快取，類似 `/events/trending`
- **快取失效策略**：活動審核、刪除時清除快取

---

## 資料結構

### 回傳格式

```ts
Array<Artist & { upcomingEventCount: number }>
```

- 包含完整 Artist 資料
- 額外新增 `upcomingEventCount` 欄位表示即將到來的活動數量

---

## Service 方法

### `getTopArtistsByUpcomingEvents(limit: number): Promise<Array<Artist & { upcomingEventCount: number }>>`

1. 取得所有 `approved` 且 `datetime.end >= now` 的活動
2. 計算每個藝人的活動數量（使用 Map）
3. 按數量排序取前 N 個藝人 ID
4. 批次取得藝人詳細資料
5. 只返回 `approved` 狀態的藝人

**Cache**：
- key: `artists:top:{limit}`
- TTL: 360 分鐘（6 小時）

---

## 快取失效

在以下操作時清除 `artists:top:*` 快取：

| 場景 | 方法 | 檔案 |
|------|------|------|
| 單一活動審核 | `updateEventStatus` | `eventService.ts` |
| 批次活動審核 | `batchUpdateEventStatus` | `eventService.ts` |
| 刪除活動 | `deleteEvent` | `eventService.ts` |

---

## API 規格

詳見 [docs/api.md](./docs/api.md)

---

## 注意事項

1. **路由順序**：`GET /top` 必須放在 `GET /:id` 之前，否則 Express 會將 `top` 視為 artistId
2. **limit 上限**：最大 50，防止一次取太多資料
3. **無分頁設計**：`/top` 語意上是取「前幾名」，不需要分頁
4. **不需要 auth**：公開 endpoint

---

## 相關檔案

- `docs/api.md` - API endpoint 規格
- `src/services/artistService.ts` - getTopArtistsByUpcomingEvents
- `src/controllers/artistController.ts` - getTopArtists
- `src/routes/artistRoutes.ts` - 路由註冊
- `src/services/eventService.ts` - 快取清除邏輯
