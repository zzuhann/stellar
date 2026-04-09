import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// 白名單：這些 email 不寄送通知信（用逗號分隔）
const emailWhitelist = new Set(
  (process.env.EMAIL_WHITELIST || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean)
);

// 管理員通知信箱：新投稿時通知此信箱
const adminNotifyEmail = process.env.ADMIN_NOTIFY_EMAIL || '';

/**
 * 檢查 email 是否在白名單中（不需要寄信）
 */
function isWhitelisted(email: string): boolean {
  return emailWhitelist.has(email.toLowerCase());
}

interface ArtistApprovalEmailData {
  email: string;
  displayName?: string;
  artistNames: string[];
}

interface EventApprovalEmailData {
  email: string;
  displayName?: string;
  events: Array<{ id: string; title: string }>;
}

/**
 * 發送藝人審核通過通知信
 * 如果同一 email 有多個 artist 通過，會合併成一封信
 */
export async function sendArtistApprovalEmail(data: ArtistApprovalEmailData): Promise<void> {
  if (!resend) {
    console.warn('RESEND_API_KEY not configured, skipping email');
    return;
  }

  const { email, displayName, artistNames } = data;

  // 白名單檢查
  if (isWhitelisted(email)) return;

  const userName = displayName || '親愛的用戶';
  const isSingle = artistNames.length === 1;

  // 主旨
  const subject = isSingle
    ? `[STELLAR] 您投稿的藝人「${artistNames[0]}」 已通過審核 ✨🧚🏻`
    : `[STELLAR] 您投稿的藝人已通過審核 ✨🧚🏻`;

  // 內文中的藝人名稱
  const artistNamesText = artistNames.join('、');
  const pronoun = isSingle ? ` ${artistNames[0]} ` : '他們';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .content {
      background: #f9f9f9;
      padding: 24px;
      border-radius: 8px;
    }
    .footer {
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid #eee;
      font-size: 14px;
      color: #666;
    }
    a {
      color: #7c3aed;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="content">
    <p>${userName} 你好～</p>

    <p>感謝你為 STELLAR 生咖地圖平台社群的貢獻！</p>

    <p>你投稿的藝人 <strong>${artistNamesText}</strong> 已通過我們的審核，</p>

    <p>現在所有粉絲都可以在平台上看到${pronoun}並且為${pronoun}新增生咖了～！</p>

    <p>已經可以在 STELLAR 首頁查看囉：<a href="https://www.stellar-zone.com">https://www.stellar-zone.com</a></p>
  </div>

  <div class="footer">
    <p>如果有任何問題，也歡迎和我們聯繫</p>
    <p>
      Threads: <a href="https://www.threads.net/@_stellar.tw">@_stellar.tw</a><br>
      Instagram: <a href="https://www.instagram.com/_stellar.tw">@_stellar.tw</a><br>
      Email: <a href="mailto:stellar.taiwan.2025@gmail.com">stellar.taiwan.2025@gmail.com</a>
    </p>
    <p>STELLAR 生咖地圖平台團隊</p>
  </div>
</body>
</html>
  `.trim();

  try {
    await resend.emails.send({
      from: 'STELLAR <noreply@stellar-zone.com>',
      to: email,
      subject,
      html,
    });
  } catch {
    // 不拋出錯誤，避免影響審核流程
  }
}

/**
 * 批次發送藝人審核通過通知信
 * 自動按 email 分組，同一 email 只寄一封信
 */
export async function sendArtistApprovalEmails(
  artists: Array<{
    createdByEmail?: string;
    stageName: string;
    createdBy: string;
  }>,
  getUserDisplayName: (userId: string) => Promise<string | undefined>
): Promise<void> {
  if (!resend) {
    console.warn('RESEND_API_KEY not configured, skipping emails');
    return;
  }

  // 按 email 分組
  const emailGroups = new Map<string, { artistNames: string[]; userId: string }>();

  for (const artist of artists) {
    if (!artist.createdByEmail) continue;

    const existing = emailGroups.get(artist.createdByEmail);
    if (existing) {
      existing.artistNames.push(artist.stageName);
    } else {
      emailGroups.set(artist.createdByEmail, {
        artistNames: [artist.stageName],
        userId: artist.createdBy,
      });
    }
  }

  // 發送郵件
  for (const [email, { artistNames, userId }] of emailGroups) {
    const displayName = await getUserDisplayName(userId);
    await sendArtistApprovalEmail({
      email,
      displayName,
      artistNames,
    });
  }
}

/**
 * 發送活動審核通過通知信
 * 如果同一 email 有多個 event 通過，會合併成一封信
 */
export async function sendEventApprovalEmail(data: EventApprovalEmailData): Promise<void> {
  if (!resend) {
    console.warn('RESEND_API_KEY not configured, skipping email');
    return;
  }

  const { email, displayName, events } = data;

  // 白名單檢查
  if (isWhitelisted(email)) return;

  const userName = displayName || '親愛的用戶';

  // 主旨（統一不列活動名稱）
  const subject = `[STELLAR] 你投稿的活動已通過審核 ✨🧚🏻`;

  // 內文中的活動名稱
  const eventTitlesText = events.map(e => e.title).join('、');

  // 活動連結列表
  const eventLinks = events
    .map(e => `<a href="https://www.stellar-zone.com/event/${e.id}">${e.title}</a>`)
    .join('<br>');

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .content {
      background: #f9f9f9;
      padding: 24px;
      border-radius: 8px;
    }
    .footer {
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid #eee;
      font-size: 14px;
      color: #666;
    }
    a {
      color: #7c3aed;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="content">
    <p>${userName} 你好～</p>

    <p>你投稿的活動 <strong>${eventTitlesText}</strong> 已通過我們的審核，</p>

    <p>現在所有粉絲都可以在平台上看到這個活動了～！</p>

    <p>點擊後可以前往活動頁面查看：<br>${eventLinks}</p>
  </div>

  <div class="footer">
    <p>如果有任何問題，也歡迎和我們聯繫</p>
    <p>
      Threads: <a href="https://www.threads.net/@_stellar.tw">@_stellar.tw</a><br>
      Instagram: <a href="https://www.instagram.com/_stellar.tw">@_stellar.tw</a><br>
      Email: <a href="mailto:stellar.taiwan.2025@gmail.com">stellar.taiwan.2025@gmail.com</a>
    </p>
    <p>STELLAR 生咖地圖平台團隊</p>
  </div>
</body>
</html>
  `.trim();

  try {
    await resend.emails.send({
      from: 'STELLAR <noreply@stellar-zone.com>',
      to: email,
      subject,
      html,
    });
  } catch {
    // 不拋出錯誤，避免影響審核流程
  }
}

/**
 * 批次發送活動審核通過通知信
 * 自動按 email 分組，同一 email 只寄一封信
 */
export async function sendEventApprovalEmails(
  events: Array<{
    id: string;
    createdByEmail?: string;
    title: string;
    createdBy: string;
  }>,
  getUserDisplayName: (userId: string) => Promise<string | undefined>
): Promise<void> {
  if (!resend) {
    console.warn('RESEND_API_KEY not configured, skipping emails');
    return;
  }

  // 按 email 分組
  const emailGroups = new Map<
    string,
    { events: Array<{ id: string; title: string }>; userId: string }
  >();

  for (const event of events) {
    if (!event.createdByEmail) continue;

    const existing = emailGroups.get(event.createdByEmail);
    if (existing) {
      existing.events.push({ id: event.id, title: event.title });
    } else {
      emailGroups.set(event.createdByEmail, {
        events: [{ id: event.id, title: event.title }],
        userId: event.createdBy,
      });
    }
  }

  // 發送郵件
  for (const [email, { events: eventList, userId }] of emailGroups) {
    const displayName = await getUserDisplayName(userId);
    await sendEventApprovalEmail({
      email,
      displayName,
      events: eventList,
    });
  }
}

/**
 * 通知管理員有新的藝人投稿
 * 如果投稿者在白名單中，則不寄送通知
 */
export async function sendArtistSubmissionNotification(
  submitterEmail: string,
  artistName: string
): Promise<void> {
  if (!resend || !adminNotifyEmail) {
    return;
  }

  // 白名單的人投稿不通知管理員
  if (isWhitelisted(submitterEmail)) return;

  const subject = '[STELLAR] 有人投稿藝人～';
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body>
  <p>有人投稿了新的藝人：<strong>${artistName}</strong></p>
  <p>可以去審核囉！</p>
  <p><a href="https://www.stellar-zone.com/admin">前往審核</a></p>
</body>
</html>
  `.trim();

  try {
    await resend.emails.send({
      from: 'STELLAR <noreply@stellar-zone.com>',
      to: adminNotifyEmail,
      subject,
      html,
    });
  } catch {
    // 不拋出錯誤，避免影響投稿流程
  }
}

/**
 * 通知管理員有新的活動投稿
 * 如果投稿者在白名單中，則不寄送通知
 */
export async function sendEventSubmissionNotification(
  submitterEmail: string,
  eventTitle: string
): Promise<void> {
  if (!resend || !adminNotifyEmail) {
    return;
  }

  // 白名單的人投稿不通知管理員
  if (isWhitelisted(submitterEmail)) {
    return;
  }

  const subject = '[STELLAR] 有人新增生咖活動～';
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body>
  <p>有人投稿了新的活動：<strong>${eventTitle}</strong></p>
  <p>可以去審核囉！</p>
  <p><a href="https://www.stellar-zone.com/admin">前往審核</a></p>
</body>
</html>
  `.trim();

  try {
    await resend.emails.send({
      from: 'STELLAR <noreply@stellar-zone.com>',
      to: adminNotifyEmail,
      subject,
      html,
    });
  } catch {
    // 不拋出錯誤，避免影響投稿流程
  }
}
