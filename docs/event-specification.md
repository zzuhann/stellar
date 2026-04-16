# Event 規格

> **重要**：新增、修改 Event 相關功能時，請同步更新此文件

---

## 資料結構

### CoffeeEvent

```typescript
interface CoffeeEvent {
  id: string;

  // 藝人（支援聯合應援）
  artists: Array<{
    id: string;
    name: string;
    profileImage?: string;
  }>;

  // 基本資訊
  title: string;
  description: string;

  // 地點
  location: {
    name: string;              // 地點名稱
    address: string;           // 完整地址
    city?: string;             // 城市（臺北市、新北市等）
    coordinates: {
      lat: number;
      lng: number;
    };
  };

  // 時間
  datetime: {
    start: Timestamp;
    end: Timestamp;
  };

  // 社群連結
  socialMedia: {
    instagram?: string;
    x?: string;
    threads?: string;
  };

  // 圖片
  mainImage?: string;
  detailImage?: string[];

  // 狀態
  status: 'pending' | 'approved' | 'rejected';
  rejectedReason?: string;

  // 統計
  viewCount?: number;

  // 認領主辦
  verifiedOrganizers?: VerifiedOrganizer[];

  // 追蹤
  createdBy: string;           // 投稿者 userId
  createdByEmail?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### VerifiedOrganizer

```typescript
interface VerifiedOrganizer {
  userId: string;
  platform: 'threads' | 'instagram';
  username: string;
  verifiedAt: Timestamp;
}
```

---

## 狀態機

```
投稿
  ↓
pending ──審核通過──→ approved
  │
  └──審核拒絕──→ rejected
                    │
                    │ 重新送審
                    ↓
                 pending
```

| 狀態 | 說明 |
|------|------|
| `pending` | 待審核，不公開顯示 |
| `approved` | 已通過，公開顯示 |
| `rejected` | 已拒絕，可重新送審 |

---

## 權限規則

### 操作權限

| 操作 | 管理員 | 投稿者 | 已認領主辦 | 一般用戶 |
|------|--------|--------|------------|----------|
| 建立 | ✓ | ✓ | ✓ | ✓ |
| 檢視（approved） | ✓ | ✓ | ✓ | ✓ |
| 檢視（pending/rejected） | ✓ | 自己的 | - | - |
| 編輯 | ✓ | 自己的 | ✓ | - |
| 刪除 | ✓ | 自己的 | ✓ | - |
| 審核 | ✓ | - | - | - |
| 認領 | - | ✓ | - | ✓ |

### 權限檢查邏輯

```typescript
const isVerifiedOrganizer = event.verifiedOrganizers?.some(
  o => o.userId === userId
);

if (userRole !== 'admin' && event.createdBy !== userId && !isVerifiedOrganizer) {
  throw new Error('權限不足');
}
```

---

## 快取策略

| 快取鍵 | TTL | 說明 |
|--------|-----|------|
| `events:approved:active` | 24 小時 | 已審核且未過期活動（基礎資料層） |
| `events:active` | 24 小時 | 進行中活動列表 |
| `events:status:{status}` | approved: 24h, rejected: 4h | 依狀態分類 |
| `events:trending:{limit}` | 6 小時 | 熱門活動 |
| `event:{id}` | 24 小時 | 單一活動詳情 |
| `events:search:{criteria}` | 4 小時 | 搜尋結果 |

### 快取清除時機

- 新增活動：清除 `events:*`、`map-data:*`、相關藝人的 `eventCount`
- 編輯活動：清除 `events:*`、`map-data:*`、`event:{id}`
- 審核活動：清除 `events:*`、`map-data:*`、`event:{id}`、`artists:approved`
- 刪除活動：清除 `events:*`、`map-data:*`、`event:{id}`、`artists:approved`

---

## API 端點

### 公開 API

| Method | Endpoint | 說明 |
|--------|----------|------|
| GET | `/api/events` | 取得活動列表（支援篩選、分頁） |
| GET | `/api/events/:id` | 取得活動詳情 |
| GET | `/api/events/:id/view` | 記錄瀏覽（+1 viewCount） |
| GET | `/api/events/trending` | 取得熱門活動 |
| GET | `/api/map-data` | 取得地圖資料 |

### 需登入 API

| Method | Endpoint | 說明 |
|--------|----------|------|
| POST | `/api/events` | 新增活動 |
| PUT | `/api/events/:id` | 編輯活動 |
| DELETE | `/api/events/:id` | 刪除活動 |
| PATCH | `/api/events/:id/resubmit` | 重新送審 |
| GET | `/api/users/me/submissions/events` | 我的投稿 |
| GET | `/api/users/me/claimed-events` | 我的認領 |

### 管理員 API

| Method | Endpoint | 說明 |
|--------|----------|------|
| PATCH | `/api/events/:id/review` | 審核活動 |
| POST | `/api/events/batch-review` | 批次審核 |

---

## 篩選參數

### EventFilterParams

| 參數 | 類型 | 說明 |
|------|------|------|
| `search` | string | 搜尋標題、藝人、地址、描述 |
| `artistId` | string | 特定藝人 ID |
| `status` | `'all' \| 'pending' \| 'approved' \| 'rejected'` | 審核狀態 |
| `region` | string | 地區名稱 |
| `createdBy` | string | 投稿者 UID |
| `startTimeFrom` | string | 開始時間範圍（從） |
| `startTimeTo` | string | 開始時間範圍（到） |
| `page` | number | 頁碼，預設 1 |
| `limit` | number | 每頁數量，預設 50，最大 100 |
| `sortBy` | `'title' \| 'startTime' \| 'createdAt'` | 排序欄位 |
| `sortOrder` | `'asc' \| 'desc'` | 排序方向，預設 desc |

### 時間區間篩選邏輯

- 只有 `startTimeFrom`：活動結束時間 >= 查詢開始時間
- 只有 `startTimeTo`：活動開始時間 <= 查詢結束時間
- 兩者都有：活動時間區間與查詢區間有重疊

---

## 地圖 API

### MapDataParams

| 參數 | 類型 | 說明 |
|------|------|------|
| `status` | `'active' \| 'upcoming' \| 'all'` | 預設 `active` |
| `bounds` | string | `"lat1,lng1,lat2,lng2"` 地圖邊界 |
| `center` | string | `"lat,lng"` 地圖中心（配合 zoom） |
| `zoom` | number | 縮放等級 |
| `search` | string | 搜尋 |
| `artistId` | string | 藝人篩選 |
| `region` | string | 地區篩選 |

---

## 驗證規則

### 必填欄位

- `artistIds`：至少一個有效且已審核的藝人
- `title`
- `description`
- `location.coordinates`：必須包含有效座標
- `datetime.start`、`datetime.end`

### viewCount 保護

- 前端不可傳入 `viewCount`
- 只能透過 `/events/:id/view` API 增加

---

## 排程任務

### cleanupExpiredActiveEventIds

清理 Artist 的 `activeEventIds` 陣列，移除已過期或不存在的活動引用。

| 項目 | 說明 |
|------|------|
| 執行時間 | 每天凌晨 00:00（Asia/Taipei） |
| 執行位置 | Cloud Function（asia-east1） |
| 檔案 | `functions/index.js` |

**清理邏輯**：

1. 取得所有 `status === 'approved'` 的藝人
2. 遍歷每個藝人的 `activeEventIds`
3. 檢查每個活動是否符合保留條件：
   - 活動存在
   - `status === 'approved'`
   - `datetime.end > now`（尚未結束）
4. 不符合條件的活動 ID 會被移除

**注意**：此任務只清理 Artist 的引用，不會刪除活動本身。

---

## 相關檔案

| 檔案 | 說明 |
|------|------|
| `src/models/types.ts` | 型別定義 |
| `src/services/eventService.ts` | 業務邏輯 |
| `src/controllers/eventController.ts` | 控制器 |
| `src/routes/eventRoutes.ts` | 路由 |
| `src/utils/cache.ts` | 快取工具 |
| `functions/index.js` | Cloud Function 排程任務 |

---

## 相關 Skills

- [event-claim](/.claude/skills/event-claim/SKILL.md) - 活動認領功能
- [page-view-tracking](/.claude/skills/page-view-tracking/SKILL.md) - 瀏覽量追蹤
