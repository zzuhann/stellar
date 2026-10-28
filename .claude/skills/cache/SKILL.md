---
name: cache
description: Cache 實現規範，定義快取鍵命名規則、TTL 設定、使用模式和失效規則，確保快取機制的一致性和有效性。
---

# Cache 實現規範

本專案使用內存快取（Memory Cache），所有 cache 操作都透過 `src/utils/cache.ts` 的 `cache` 實例進行。

## 核心 API

```typescript
import { cache } from '../utils/cache';

// 取得目前的清除版本（手動讀取前先記下，見「使用模式」）
cache.version(): number

// 設定快取；readVersion 是讀取前記下的版本，期間這個 key 被清除過就不寫入
cache.set<T>(key: string, data: T, ttlMinutes: number, readVersion?: number): void

// 取得快取
cache.get<T>(key: string): T | null

// 帶 Lock 的快取取得（防止雪崩效應）
cache.getWithLock<T>(key: string, fetchFn: () => Promise<T>, ttlMinutes: number): Promise<T>

// 刪除單一快取
cache.delete(key: string): void

// 清除符合模式的快取
cache.clearPattern(pattern: string): void

// 清除所有快取
cache.clear(): void
```

## Cache Key 命名規則

使用 `:` 作為分隔符，格式為 `{資源類型}:{條件}`：

| 資源類型 | Key 格式 | 範例 |
|---------|---------|------|
| 基礎事件資料 | `events:{status}:{條件}` | `events:approved:active` |
| 單一事件 | `event:{eventId}` | `event:abc123` |
| 藝人列表 | `artists:{條件}` | `artists:approved` |
| 單一藝人 | `artist:{artistId}` | `artist:xyz789` |
| 藝人過濾 | `artists:filters:{JSON}` | `artists:filters:{"genre":"jazz"}` |
| 收藏狀態 | `favorite:{userId}:{eventId}` | `favorite:user1:event1` |
| 收藏列表 | `favorites:{userId}:{JSON}` | `favorites:user1:{}` |

**複雜參數使用 `JSON.stringify()` 序列化**

## TTL 設定規範

| 數據類型 | TTL (分鐘) | 說明 |
|---------|-----------|------|
| 已審核資料 (approved) | 1440 (24hr) | 穩定數據，變動不頻繁 |
| 已拒絕資料 (rejected) | 60-240 | 可能被重新送審 |
| 搜尋結果 | 240 (4hr) | 可能被新資料影響 |
| 單一資源 | 360 (6hr) | 中等快取時間 |
| 不存在的資源 (null) | 15 | 短期快取避免重複查詢 |
| 用戶相關 (收藏等) | 1440 (24hr) | 用戶操作不頻繁 |

## 使用模式

**手動「讀快取 → 查資料庫 → 寫快取」一律帶版本**：查資料庫前先 `const cacheVersion = cache.version()`，寫回時 `cache.set(key, data, ttl, cacheVersion)`。讀取途中這個 key 被清除（例如活動剛好被核准）時，寫回會被略過，避免把改動前的舊資料存滿整個 TTL。`getWithLock` 內建同樣的保護，不用另外帶。

### 1. 基本查詢快取

```typescript
async getResource(): Promise<Resource[]> {
  const cacheKey = 'resources:active';
  const cacheVersion = cache.version();
  const cached = cache.get<Resource[]>(cacheKey);
  if (cached) return cached;

  const result = await this.fetchFromDB();
  cache.set(cacheKey, result, 1440, cacheVersion);
  return result;
}
```

### 2. 帶過濾參數的快取

```typescript
async getResourcesWithFilters(filters: FilterParams): Promise<Resource[]> {
  const cacheKey = `resources:filters:${JSON.stringify(filters)}`;
  const cacheVersion = cache.version();
  const cached = cache.get<Resource[]>(cacheKey);
  if (cached) return cached;

  const result = await this.fetchWithFilters(filters);
  cache.set(cacheKey, result, 1440, cacheVersion);
  return result;
}
```

### 3. 條件式快取（某些情況不快取）

```typescript
async getResourcesWithUser(filters: FilterParams, userId?: string): Promise<Resource[]> {
  const cacheKey = `resources:filters:${JSON.stringify(filters)}`;
  const cacheVersion = cache.version();

  // 有 userId 時不使用快取，因為需要檢查用戶特定狀態
  if (!userId) {
    const cached = cache.get<Resource[]>(cacheKey);
    if (cached) return cached;
  }

  const result = await this.fetchWithFilters(filters);

  // 只有無 userId 的情況才快取
  if (!userId) {
    cache.set(cacheKey, result, 1440, cacheVersion);
  }

  return result;
}
```

### 4. 可能為 null 的資源快取

> ⚠️ 目前這個寫法的 null 快取**不會生效**：`cache.get` 沒命中時也回傳 `null`，所以分不出「沒快取」和「快取了 null」，查不到的資源每次都會重查資料庫（只多花讀取，不影響正確性）。`artistService.getArtistById` 就是這樣，已記 backlog；修好前不要依賴它擋重複查詢。

```typescript
async getResourceById(id: string): Promise<Resource | null> {
  const cacheKey = `resource:${id}`;
  const cacheVersion = cache.version();
  const cached = cache.get<Resource | null>(cacheKey);
  if (cached !== null) return cached;

  const result = await this.fetchById(id);

  // null 結果也快取，但 TTL 較短
  cache.set(cacheKey, result, result ? 360 : 15, cacheVersion);
  return result;
}
```

### 5. 帶 Lock 的快取（防止雪崩效應）

當快取過期時，如果同時有大量請求進入，會導致所有請求都去查詢資料庫（雪崩效應）。使用 `getWithLock` 可以確保只有一個請求執行查詢，其他請求等待結果。

```typescript
async getResourceBase(): Promise<Resource[]> {
  return cache.getWithLock(
    'resources:approved:active',
    async () => {
      const snapshot = await this.collection.where('status', '==', 'approved').get();
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as Resource);
    },
    1440 // 24 小時 TTL
  );
}
```

**適用場景：**
- 高頻率存取的基礎資料
- 查詢成本較高的資料（如需要多次 DB 查詢）
- 作為分層快取的基礎層

### 6. 分層快取策略

對於複雜的查詢場景，使用分層快取可以提高快取命中率並減少重複查詢：

```typescript
// 基礎資料層（使用 Lock 防止雪崩）
private async getApprovedActiveResourcesBase(): Promise<Resource[]> {
  return cache.getWithLock(
    'resources:approved:active',
    async () => {
      const snapshot = await this.collection.where('status', '==', 'approved').get();
      const now = Date.now();
      return snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }) as Resource)
        .filter(resource => resource.endTime.toMillis() >= now);
    },
    1440
  );
}

// 應用層：基於基礎資料進行記憶體內篩選
async getResourcesWithFilters(filters: FilterParams): Promise<Resource[]> {
  // 使用共用的基礎資料
  let resources = await this.getApprovedActiveResourcesBase();

  // 在記憶體中進行篩選
  if (filters.city) {
    resources = resources.filter(r => r.city === filters.city);
  }
  if (filters.keyword) {
    resources = resources.filter(r => r.name.includes(filters.keyword));
  }

  return resources;
}
```

**優點：**
- 所有請求共用同一份基礎資料快取
- 避免每個篩選組合都產生獨立的快取 key
- 使用 Lock 機制防止快取過期時的雪崩效應
- 減少資料庫查詢次數

## 快取失效規則

**寫入操作後必須清除相關快取：**

### 新增資源後

```typescript
async createResource(data: CreateData): Promise<Resource> {
  const result = await this.saveToDb(data);

  // 清除列表類快取
  cache.clearPattern('resources:');

  return result;
}
```

### 更新資源後

```typescript
async updateResource(id: string, data: UpdateData): Promise<Resource> {
  const result = await this.updateInDb(id, data);

  // 清除單一資源快取
  cache.delete(`resource:${id}`);
  // 清除列表類快取
  cache.clearPattern('resources:');

  return result;
}
```

### 刪除資源後

```typescript
async deleteResource(id: string): Promise<void> {
  await this.deleteFromDb(id);

  cache.delete(`resource:${id}`);
  cache.clearPattern('resources:');
}
```

### 跨資源關聯失效

當操作影響多種資源時，需清除所有相關快取：

```typescript
// 例：刪除事件時，也要清除藝人統計快取
async deleteEvent(id: string): Promise<void> {
  await this.deleteFromDb(id);

  // 清除基礎資料快取（地圖資料等衍生查詢會自動使用新的基礎資料）
  cache.clearPattern('events:');
  cache.clearPattern('artists:'); // 藝人的活動計數可能改變
}
```

## 新增 Cache Key 檢查清單

實作新的 cache key 時，必須同步確認**所有會使該資料變動的寫入路徑**都有對應的清除邏輯。

**步驟：**
1. 列出新 key 儲存的是什麼資料
2. 找出所有會改變這份資料的操作（create、update、delete、關聯變動）
3. 在每個操作的末尾補上 `cache.delete(newKey)`

**範例：新增 `resource:admin:detail:{id}` key**

```
需要清除的操作：
- updateResource()     ← 資料改變
- deactivateResource() ← status 改變
- permanentDelete()    ← 資料消失
- linkRelatedData()    ← 關聯改變
```

如果只在 `permanentDelete` 清了新 key，而 `updateResource` 沒清，admin 編輯後會讀到舊的快取。

---

## 注意事項

1. **不要快取 pending 狀態的資料** - 這類資料變動頻繁
2. **用戶特定資料不適合用列表快取** - 需要檢查用戶狀態時跳過快取
3. **批次操作後一次性清除快取** - 避免多次清除造成效能問題
4. **使用 `clearPattern` 時注意模式** - 確保只清除相關快取，不要過度清除
5. **快取 null 值** - 防止對不存在資源的重複查詢，但使用較短 TTL（⚠️ 目前寫法不會生效，見模式 4）
6. **高頻存取資料使用 `getWithLock`** - 防止快取過期時的雪崩效應
7. **優先使用分層快取** - 多個 API 共用基礎資料時，避免重複快取相似資料
8. **手動讀寫快取一定帶 `cacheVersion`** - 沒帶的話，讀取途中資料被改動並清除快取時，舊資料會被寫回並存滿整個 TTL（見「使用模式」開頭）
