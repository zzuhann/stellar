# Event Claim - 後端實作清單

> 實作完成於 2026-04-15
> 權限擴充於 2026-04-16

---

## 環境變數

| 變數名                    | 說明                    |
| ------------------------- | ----------------------- |
| `THREADS_APP_ID`          | Threads App ID          |
| `THREADS_APP_SECRET`      | Threads App Secret      |
| `OAUTH_CALLBACK_BASE_URL` | OAuth callback base URL |
| `FRONTEND_URL`            | 前端網址                |

### 取得 Threads App ID / Secret

1. 前往 [Meta for Developers](https://developers.facebook.com/)
2. 建立新 App 或選擇現有 App
3. 左側選單 → 使用案例 → 自訂 → 其他 → 新增「Threads API」
4. 左側選單 → Threads API 使用案例頁面
   - **Threads 應用程式編號** = `THREADS_APP_ID`
   - **Threads 應用程式密鑰** = `THREADS_APP_SECRET`
5. 設定有效的 OAuth 重新導向 URI：`{OAUTH_CALLBACK_BASE_URL}/auth/threads/callback`

> **注意**：App 未發佈前，需在「使用案例 → Threads API → 新增 Threads 測試人員」加入測試帳號

---

## API 端點

| Method | Endpoint                       | 說明               | 需登入 |
| ------ | ------------------------------ | ------------------ | ------ |
| GET    | `/api/auth/threads`            | 發起 OAuth         | ✓      |
| GET    | `/api/auth/threads/callback`   | OAuth callback     | ✗      |
| GET    | `/api/users/me/claimed-events` | 查詢已認領活動列表 | ✓      |

---

## 檔案總覽

| 檔案                                 | 類型 |
| ------------------------------------ | ---- |
| `src/config/oauth.ts`                | 新增 |
| `src/routes/authRoutes.ts`           | 新增 |
| `src/routes/index.ts`                | 修改 |
| `src/routes/userRoutes.ts`           | 修改 |
| `src/controllers/authController.ts`  | 新增 |
| `src/controllers/userController.ts`  | 修改 |
| `src/services/oauthService.ts`       | 新增 |
| `src/services/eventService.ts`       | 修改 |
| `src/models/types.ts`                | 修改 |

---

## 測試案例

| 測試情境                   | 預期結果                           |
| -------------------------- | ---------------------------------- |
| 用戶已登入，發起 OAuth     | Redirect 到 Threads                |
| 用戶未登入，發起 OAuth     | 401 Unauthorized                   |
| 授權成功，username 符合    | 認領成功，redirect 到前端          |
| 授權成功，username 不符    | redirect 到前端帶 error            |
| 用戶取消授權               | redirect 到前端帶 cancelled        |
| State 過期（超過 10 分鐘） | redirect 到前端帶 state_expired    |
| 重複認領同一活動           | redirect 到前端帶 already_claimed  |
| 活動不存在                 | redirect 到前端帶 event_not_found  |

---

## 主辦方權限

已認領主辦（`verifiedOrganizers` 包含該用戶）享有與投稿者相同的權限：

| 操作 | 管理員 | 投稿者 | 已認領主辦 |
| ---- | ------ | ------ | ---------- |
| 編輯 | ✓      | ✓      | ✓          |
| 刪除 | ✓      | ✓      | ✓          |

權限檢查邏輯（`eventService.ts`）：
```typescript
const isVerifiedOrganizer = eventData?.verifiedOrganizers?.some(
  o => o.userId === userId
);
if (userRole !== 'admin' && eventData?.createdBy !== userId && !isVerifiedOrganizer) {
  throw new Error('權限不足');
}
```
