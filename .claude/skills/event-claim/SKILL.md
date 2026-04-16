---
name: event-claim
description: 活動認領功能 - Threads OAuth 驗證主辦方身份
---

# 活動認領功能 - 後端

> **重要**：新增、修改實作時，請同步更新：
> - [docs/implementation.md](./docs/implementation.md) - 實作狀態
> - [/docs/event-specification.md](/docs/event-specification.md) - Event 通用規格

## 功能概述

讓活動主辦方透過 Threads OAuth 驗證身份，認領由他人投稿的活動，認領成功後可取得編輯、刪除權限。

---

## 設計原則

- **OAuth 標準流程**：使用 authorization code flow
- **安全性優先**：App Secret 只在後端使用，state 參數防 CSRF
- **彈性比對**：Threads 帳號可比對活動的 threads 或 instagram 欄位（因為通常相同）

---

## 認領流程

```
用戶點「認領活動」（前端）
    ↓
GET /api/auth/threads?eventId=xxx（後端）
    ↓
Redirect 到 Threads OAuth 授權頁
    ↓
用戶授權後，Threads redirect 到 callback
    ↓
GET /api/auth/threads/callback?code=xxx&state=xxx（後端）
    ↓
用 code 換 access token
    ↓
用 token 取得 username
    ↓
比對 username 是否符合活動的 socialMedia
    ↓
✓ 符合 → 寫入 verifiedOrganizers，redirect 到前端（成功）
✗ 不符 → redirect 到前端（失敗）
```

---

## 資料結構

### VerifiedOrganizer（新增 interface）

```typescript
interface VerifiedOrganizer {
  userId: string;                           // 認領者的 user id
  platform: 'threads' | 'instagram';        // 驗證平台
  username: string;                         // 社群帳號 username
  verifiedAt: Timestamp;                    // 驗證時間
}
```

### CoffeeEvent（新增欄位）

```typescript
interface CoffeeEvent {
  // ... 現有欄位 ...

  verifiedOrganizers?: VerifiedOrganizer[];
}
```

---

## 環境變數

```env
# Threads OAuth
THREADS_APP_ID=xxxxxxxxxx
THREADS_APP_SECRET=xxxxxxxxxx

# OAuth 設定
OAUTH_CALLBACK_BASE_URL=https://stellar.zeabur.app/api
FRONTEND_URL=https://www.stellar-zone.com
```

> **注意**：`THREADS_APP_ID` 是 Threads API 專屬的 App ID，不是 Meta App 的主要 App ID。
> 取得方式：Meta Developer Console → 你的 App → Threads API → 使用案例頁面顯示的 App ID。

---

## API 端點

### 1. 發起 OAuth 授權

**`GET /api/auth/threads`**

| 參數 | 位置 | 必填 | 說明 |
|------|------|------|------|
| eventId | query | ✓ | 要認領的活動 ID |
| redirectUrl | query | ✗ | 完成後跳轉的前端頁面（預設活動詳情頁） |

**需要登入**：`authenticateToken`

**流程**：
1. 驗證用戶已登入
2. 驗證活動存在且尚未被此用戶認領
3. 將 `eventId`、`userId`、`redirectUrl` 編碼到 OAuth state
4. Redirect 到 Threads OAuth 授權頁面

**Threads OAuth URL**：
```
https://threads.net/oauth/authorize
  ?client_id={THREADS_APP_ID}
  &redirect_uri={OAUTH_CALLBACK_BASE_URL}/auth/threads/callback
  &scope=threads_basic
  &response_type=code
  &state={encodedState}
```

---

### 2. OAuth Callback

**`GET /api/auth/threads/callback`**

| 參數 | 位置 | 說明 |
|------|------|------|
| code | query | Threads 授權碼 |
| state | query | 編碼的狀態（含 eventId, userId, redirectUrl） |
| error | query | 錯誤代碼（用戶拒絕授權時） |

**流程**：
1. 解碼 state 取得 `eventId`、`userId`、`redirectUrl`
2. 驗證 state timestamp（10 分鐘內有效）
3. 用 `code` + `App Secret` 換取 access token
4. 用 token 呼叫 Threads API 取得 username
5. 比對 username 是否符合活動的 socialMedia
6. 符合 → 寫入 `verifiedOrganizers`，redirect 到前端
7. 不符 → redirect 到前端（帶錯誤參數）

---

## 外部 API

### 換 Token

```http
POST https://graph.threads.net/oauth/access_token
Content-Type: application/x-www-form-urlencoded

client_id={THREADS_APP_ID}
&client_secret={THREADS_APP_SECRET}
&grant_type=authorization_code
&redirect_uri={OAUTH_CALLBACK_BASE_URL}/auth/threads/callback
&code={code}
```

**Response**：
```json
{
  "access_token": "xxx",
  "user_id": "123456789"
}
```

### 取得 Username

```http
GET https://graph.threads.net/v1.0/me?fields=id,username&access_token={token}
```

**Response**：
```json
{
  "id": "123456789",
  "username": "npclabtaichung"
}
```

---

## 比對邏輯

```typescript
const oauthUsername = threadsResponse.username.toLowerCase();

// 從活動的 socialMedia 取得所有帳號
const { instagram, threads } = event.socialMedia;

// 解析逗號分隔的帳號（支援多主辦）
const allUsernames = [
  ...(threads?.split(',').map(s => s.trim().toLowerCase()) || []),
  ...(instagram?.split(',').map(s => s.trim().toLowerCase()) || []),
];

// 只要任一符合即可
const isMatch = allUsernames.includes(oauthUsername);
```

**比對規則**：

| 活動填寫 | Threads 驗證結果 | 可認領？ |
|---------|-----------------|---------|
| threads: "npclab" | npclab | ✓ |
| instagram: "npclab" | npclab | ✓ |
| threads: "npclab", instagram: "npclab" | npclab | ✓ |
| threads: "a, b", instagram: "c" | b | ✓ |
| instagram: "other" | npclab | ✗ |

---

## State 編碼

```typescript
// 編碼
const state = Buffer.from(JSON.stringify({
  eventId,
  userId,
  redirectUrl,
  timestamp: Date.now(),
})).toString('base64url');

// 解碼
const decoded = JSON.parse(Buffer.from(state, 'base64url').toString());

// 驗證（10 分鐘內有效）
if (Date.now() - decoded.timestamp > 10 * 60 * 1000) {
  throw new Error('State expired');
}
```

---

## Redirect 回前端

| 情況 | Redirect URL |
|------|-------------|
| 成功 | `{redirectUrl}?claim=success&platform=threads` |
| 取消授權 | `{redirectUrl}?claim=error&reason=cancelled` |
| Username 不符 | `{redirectUrl}?claim=error&reason=username_mismatch` |
| 已認領過 | `{redirectUrl}?claim=error&reason=already_claimed` |
| Token 交換失敗 | `{redirectUrl}?claim=error&reason=oauth_failed` |
| 活動不存在 | `{redirectUrl}?claim=error&reason=event_not_found` |
| State 過期 | `{redirectUrl}?claim=error&reason=state_expired` |

---

## 錯誤處理

OAuth callback 不回傳 JSON，一律 redirect 到前端帶參數，由前端顯示 toast 或訊息。

---

## 安全性

1. **State 參數**：包含 timestamp 防止 CSRF 攻擊
2. **用戶驗證**：發起 OAuth 前必須先登入（`authenticateToken`）
3. **重複認領檢查**：同一用戶不能重複認領同一活動
4. **App Secret**：只在後端使用，絕不暴露給前端
5. **State 過期**：10 分鐘內必須完成授權

---

## 測試

Meta App 未發佈前，需要先在 Meta Developer 後台新增測試人員：
- 進入 App → 使用案例 → 存取 Threads API → 新增或移除 Threads 測試人員

---

## 主辦方權限

已認領主辦享有與投稿者相同的權限：

| 操作 | 管理員 | 投稿者 | 已認領主辦 |
|------|--------|--------|------------|
| 編輯 | ✓ | ✓ | ✓ |
| 刪除 | ✓ | ✓ | ✓ |

---

## 相關檔案

- `docs/implementation.md` - 實作狀態與檔案清單
- `docs/api.md` - 用戶已認領活動 API 規格
- `src/routes/authRoutes.ts` - OAuth 路由
- `src/controllers/authController.ts` - OAuth 控制器
- `src/services/oauthService.ts` - OAuth 服務（token 交換、取得 username）
- `src/services/eventService.ts` - 新增 `addVerifiedOrganizer`、`getUserClaimedEventsPaginated` 方法
- `src/config/oauth.ts` - OAuth 設定
- `src/models/types.ts` - 新增 `VerifiedOrganizer`、`UserClaimedEventsListResponse` interface
