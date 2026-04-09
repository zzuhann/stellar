# Email 通知規格

## 環境變數

```env
RESEND_API_KEY=re_xxxxxxxx
EMAIL_WHITELIST=email1@example.com,email2@example.com
ADMIN_NOTIFY_EMAIL=admin@example.com
```

| 變數 | 說明 |
|------|------|
| `RESEND_API_KEY` | Resend API Key |
| `EMAIL_WHITELIST` | 白名單，多個 email 用逗號分隔，這些 email 不寄送通知信，投稿時也不通知管理員 |
| `ADMIN_NOTIFY_EMAIL` | 管理員信箱，有新投稿時通知此信箱 |

## 寄件人

```
STELLAR <noreply@stellar-zone.com>
```

---

## 新投稿通知管理員

當用戶送出投稿時，寄信通知管理員前往審核。

**注意**：如果投稿者的 email 在白名單中，則不寄送通知。

### 藝人投稿

- **觸發時機**：
  - 新投稿 `POST /artists`
  - 重新送審 `PATCH /artists/:id/resubmit`
- **收件人**：`ADMIN_NOTIFY_EMAIL`
- **主旨**：`[STELLAR] 有人投稿藝人～`
- **內文**：
  ```
  有人投稿了新的藝人：{{artist_name}}
  可以去審核囉！
  前往審核（連結到 /admin）
  ```

### 活動投稿

- **觸發時機**：
  - 新投稿 `POST /events`
  - 重新送審 `PATCH /events/:id/resubmit`
- **收件人**：`ADMIN_NOTIFY_EMAIL`
- **主旨**：`[STELLAR] 有人新增生咖活動～`
- **內文**：
  ```
  有人投稿了新的活動：{{event_title}}
  可以去審核囉！
  前往審核（連結到 /admin）
  ```

---

## 藝人審核通過

### 觸發時機
- 單筆審核 `PATCH /artists/:id/review` status=approved
- 批次審核 `POST /artists/batch-review` status=approved

### 主旨

| 條件 | 主旨 |
|------|------|
| 同一 email 只有 1 個藝人通過 | `[STELLAR] 您投稿的藝人「{{artist_name}}」 已通過審核 ✨🧚🏻` |
| 同一 email 有多個藝人通過 | `[STELLAR] 您投稿的藝人已通過審核 ✨🧚🏻` |

### 內文

```
{{user_name}} 你好～

感謝你為 STELLAR 生咖地圖平台社群的貢獻！

你投稿的藝人 {{artist_names}} 已通過我們的審核，

現在所有粉絲都可以在平台上看到 {{pronoun}} 並且為 {{pronoun}} 新增生咖了～！

已經可以在 STELLAR 首頁查看囉：https://www.stellar-zone.com

---

如果有任何問題，也歡迎和我們聯繫
Threads: @_stellar.tw
Instagram: @_stellar.tw
Email: stellar.taiwan.2025@gmail.com

STELLAR 生咖地圖平台團隊
```

| 變數 | 說明 |
|------|------|
| `{{user_name}}` | 用戶 displayName，若無則為「親愛的用戶」 |
| `{{artist_names}}` | 藝人名稱，多個用頓號分隔（例：A、B、C） |
| `{{pronoun}}` | 單一藝人時為藝人名稱，多個時為「他們」 |

## 活動審核通過

### 觸發時機
- 單筆審核 `PATCH /events/:id/review` status=approved
- 批次審核 `POST /events/batch-review` status=approved

### 主旨

統一為：
```
[STELLAR] 你投稿的活動已通過審核 ✨🧚🏻
```

### 內文

```
{{user_name}} 你好～

你投稿的活動 {{event_titles}} 已通過我們的審核，

現在所有粉絲都可以在平台上看到這個活動了～！

點擊後可以前往活動頁面查看：
{{event_links}}

---

如果有任何問題，也歡迎和我們聯繫
Threads: @_stellar.tw
Instagram: @_stellar.tw
Email: stellar.taiwan.2025@gmail.com

STELLAR 生咖地圖平台團隊
```

| 變數 | 說明 |
|------|------|
| `{{user_name}}` | 用戶 displayName，若無則為「親愛的用戶」 |
| `{{event_titles}}` | 活動標題，多個用頓號分隔（例：A、B、C） |
| `{{event_links}}` | 活動連結列表，每個標題可點擊，格式為 `https://www.stellar-zone.com/event/{id}` |

## 批次審核合併邏輯

無論是單筆審核還是批次審核，系統會自動按 `createdByEmail` 分組：

- 同一 email 的多個投稿，只寄送**一封信**
- 信件內容會列出所有通過審核的項目

## 相關檔案

| 檔案 | 說明 |
|------|------|
| `src/services/emailService.ts` | Email 發送邏輯 |
| `src/services/artistService.ts` | 藝人審核時呼叫寄信 |
| `src/services/eventService.ts` | 活動審核時呼叫寄信 |
