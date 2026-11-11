import * as Sentry from '@sentry/node';
import type { Resend } from 'resend';
import { redactEmails } from '../utils/sentryRedaction';

const resendApiKey = process.env.RESEND_API_KEY;
const hasResendKey = !!resendApiKey;

// Lazy-load: resend pulls in ~235 svix modules, which slows Cloud Run cold starts
let resendClient: Promise<Resend> | undefined;
function sendEmail(payload: Parameters<Resend['emails']['send']>[0]) {
  resendClient ??= import('resend')
    .then(({ Resend }) => new Resend(resendApiKey))
    .catch(err => {
      resendClient = undefined; // don't cache a failed load; retry on next send
      throw err;
    });
  return resendClient
    .then(resend => resend.emails.send(payload))
    .then(({ error }) => {
      // Resend reports API failures in the result instead of throwing
      if (error) throw new Error(`Resend ${error.name}: ${error.message}`);
    })
    .catch(err => {
      Sentry.captureException(err, { tags: { context: 'email_send' } });
      throw err;
    });
}

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

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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
  if (!hasResendKey) {
    console.warn('RESEND_API_KEY not configured, skipping email');
    return;
  }

  const { email, displayName, artistNames } = data;

  // 白名單檢查
  if (isWhitelisted(email)) return;

  const userName = escapeHtml(displayName || '親愛的用戶');
  const isSingle = artistNames.length === 1;

  // 主旨
  const subject = isSingle
    ? `[STELLAR] 你投稿的藝人「${artistNames[0]}」 已通過審核 ✨🧚🏻`
    : `[STELLAR] 你投稿的藝人已通過審核 ✨🧚🏻`;

  // 內文中的藝人名稱
  const artistNamesText = artistNames.map(escapeHtml).join('、');
  const pronoun = isSingle ? ` ${escapeHtml(artistNames[0])} ` : '他們';

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
      Threads: <a href="https://www.threads.com/@_stellar.tw">@_stellar.tw</a><br>
      Instagram: <a href="https://www.instagram.com/_stellar.tw">@_stellar.tw</a><br>
      Email: <a href="mailto:stellar.taiwan.2025@gmail.com">stellar.taiwan.2025@gmail.com</a>
    </p>
    <p>STELLAR 生咖地圖平台團隊</p>
  </div>
</body>
</html>
  `.trim();

  try {
    await sendEmail({
      from: 'STELLAR <noreply@stellar-zone.com>',
      to: email,
      subject,
      html,
    });
    console.log(`[email] artist approval sent to ${email} (${artistNames.join(', ')})`);
  } catch (err) {
    console.error(`[email] failed to send artist approval to ${email}:`, err);
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
  if (!hasResendKey) {
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
  if (!hasResendKey) {
    console.warn('RESEND_API_KEY not configured, skipping email');
    return;
  }

  const { email, displayName, events } = data;

  // 白名單檢查
  if (isWhitelisted(email)) return;

  const userName = escapeHtml(displayName || '親愛的用戶');

  // 主旨（統一不列活動名稱）
  const subject = `[STELLAR] 你投稿的活動已通過審核 ✨🧚🏻`;

  // 內文中的活動名稱
  const eventTitlesText = events.map(e => escapeHtml(e.title)).join('、');

  // 活動連結列表
  const eventLinks = events
    .map(
      e =>
        `<a href="https://www.stellar-zone.com/event/${encodeURIComponent(e.id)}">${escapeHtml(e.title)}</a>`
    )
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
      Threads: <a href="https://www.threads.com/@_stellar.tw">@_stellar.tw</a><br>
      Instagram: <a href="https://www.instagram.com/_stellar.tw">@_stellar.tw</a><br>
      Email: <a href="mailto:stellar.taiwan.2025@gmail.com">stellar.taiwan.2025@gmail.com</a>
    </p>
    <p>STELLAR 生咖地圖平台團隊</p>
  </div>
</body>
</html>
  `.trim();

  try {
    await sendEmail({
      from: 'STELLAR <noreply@stellar-zone.com>',
      to: email,
      subject,
      html,
    });
    console.log(`[email] event approval sent to ${email} (${events.map(e => e.title).join(', ')})`);
  } catch (err) {
    console.error(`[email] failed to send event approval to ${email}:`, err);
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
  if (!hasResendKey) {
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
  submitterEmail: string | undefined,
  artistName: string
): Promise<void> {
  if (!hasResendKey || !adminNotifyEmail) {
    return;
  }

  // 白名單的人投稿不通知管理員
  if (submitterEmail && isWhitelisted(submitterEmail)) return;

  const submitterInfo = submitterEmail || '匿名用戶';
  const subject = '[STELLAR] 有人投稿藝人～';
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body>
  <p>有人投稿了新的藝人：<strong>${escapeHtml(artistName)}</strong></p>
  <p>投稿者：${escapeHtml(submitterInfo)}</p>
  <p>可以去審核囉！</p>
  <p><a href="https://www.stellar-zone.com/admin">前往審核</a></p>
</body>
</html>
  `.trim();

  try {
    await sendEmail({
      from: 'STELLAR <noreply@stellar-zone.com>',
      to: adminNotifyEmail,
      subject,
      html,
    });
    console.log(
      `[email] artist submission notification sent (artist: ${artistName}, submitter: ${submitterEmail})`
    );
  } catch (err) {
    console.error(
      `[email] failed to send artist submission notification (artist: ${artistName}):`,
      err
    );
  }
}

const CONTACT_RECEIVER = 'stellar.taiwan.2025@gmail.com';

/**
 * 聯絡表單送出後：
 * 1. 寄表單內容給 STELLAR 信箱（失敗則丟錯）
 * 2. 寄確認信給使用者（失敗只記錄並回報 Sentry）
 */
export async function sendContactNotification(data: {
  name: string;
  email: string;
  message: string;
}): Promise<void> {
  if (!hasResendKey) {
    console.warn('[email] contact notification skipped: RESEND_API_KEY not configured');
    return;
  }

  const { name, email, message } = data;

  const confirmationHtml = `
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
    a { color: #7c3aed; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="content">
    <p>你好～</p>
    <p>感謝你聯絡 STELLAR！</p>
    <p>我們已經收到你的訊息，將會盡快回覆你。</p>
  </div>
  <div class="footer">
    <p>
      Threads: <a href="https://www.threads.com/@_stellar.tw">@_stellar.tw</a><br>
      Instagram: <a href="https://www.instagram.com/_stellar.tw">@_stellar.tw</a><br>
      Email: <a href="mailto:stellar.taiwan.2025@gmail.com">stellar.taiwan.2025@gmail.com</a>
    </p>
    <p>STELLAR 生咖地圖平台團隊</p>
  </div>
</body>
</html>
  `.trim();

  const notificationHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body>
  <p><strong>暱稱：</strong>${escapeHtml(name)}</p>
  <p><strong>Email：</strong>${escapeHtml(email)}</p>
  <p><strong>訊息內容：</strong></p>
  <p style="white-space: pre-wrap">${escapeHtml(message)}</p>
</body>
</html>
  `.trim();

  // Notify first so a failure lets the user retry before any "we got it" email goes out
  await sendEmail({
    from: 'STELLAR <noreply@stellar-zone.com>',
    to: CONTACT_RECEIVER,
    subject: `[STELLAR] 新的聯絡表單訊息 - ${name}`,
    html: notificationHtml,
  });
  console.log(`[email] contact notification sent to ${CONTACT_RECEIVER} (from: ${email})`);

  try {
    await sendEmail({
      from: 'STELLAR <noreply@stellar-zone.com>',
      to: email,
      subject: '[STELLAR] 已收到你的訊息！',
      html: confirmationHtml,
    });
    console.log(`[email] contact confirmation sent to ${email}`);
  } catch (err) {
    // We already have the message; a missing confirmation is not worth failing the request
    console.error(`[email] failed to send contact confirmation to ${email}:`, err);
  }
}

/**
 * 通知管理員有新的活動投稿
 * 如果投稿者在白名單中，則不寄送通知
 */
export async function sendEventSubmissionNotification(
  submitterEmail: string | undefined,
  eventTitle: string
): Promise<void> {
  if (!hasResendKey || !adminNotifyEmail) {
    return;
  }

  // 白名單的人投稿不通知管理員
  if (submitterEmail && isWhitelisted(submitterEmail)) {
    return;
  }

  const submitterInfo = submitterEmail || '匿名用戶';
  const subject = '[STELLAR] 有人新增生咖活動～';
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body>
  <p>有人投稿了新的活動：<strong>${escapeHtml(eventTitle)}</strong></p>
  <p>投稿者：${escapeHtml(submitterInfo)}</p>
  <p>可以去審核囉！</p>
  <p><a href="https://www.stellar-zone.com/admin">前往審核</a></p>
</body>
</html>
  `.trim();

  try {
    await sendEmail({
      from: 'STELLAR <noreply@stellar-zone.com>',
      to: adminNotifyEmail,
      subject,
      html,
    });
    console.log(
      `[email] event submission notification sent (event: ${eventTitle}, submitter: ${submitterEmail})`
    );
  } catch (err) {
    console.error(
      `[email] failed to send event submission notification (event: ${eventTitle}):`,
      err
    );
  }
}

export async function sendVenueSubmissionNotification(venueName: string): Promise<void> {
  if (!hasResendKey || !adminNotifyEmail) return;

  const escapedVenueName = escapeHtml(venueName);
  const loggedVenueName = JSON.stringify(venueName);
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
  <p>有人投稿了新的場地：<strong>${escapedVenueName}</strong></p>
  <p>可以去審核囉！</p>
  <p><a href="https://www.stellar-zone.com/admin-new/venues">前往審核</a></p>
</body>
</html>
  `.trim();

  try {
    await sendEmail({
      from: 'STELLAR <noreply@stellar-zone.com>',
      to: adminNotifyEmail,
      subject: '[STELLAR] 有人投稿場地～',
      html,
    });
    console.log(`[email] venue submission notification sent (venue: ${loggedVenueName})`);
  } catch (err) {
    console.error(
      `[email] failed to send venue submission notification (venue: ${loggedVenueName}):`,
      err
    );
  }
}

// ---- Review result mails (rejection / exists) ----

const MY_SUBMISSIONS_URL = 'https://www.stellar-zone.com/my-submissions';

// Shared shell for the review result mails; the older mails still carry their own copies.
function renderLayout(contentHtml: string): string {
  return `
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
${contentHtml}
  </div>

  <div class="footer">
    <p>如果有任何問題，也歡迎和我們聯繫</p>
    <p>
      Threads: <a href="https://www.threads.com/@_stellar.tw">@_stellar.tw</a><br>
      Instagram: <a href="https://www.instagram.com/_stellar.tw">@_stellar.tw</a><br>
      Email: <a href="mailto:stellar.taiwan.2025@gmail.com">stellar.taiwan.2025@gmail.com</a>
    </p>
    <p>STELLAR 生咖地圖平台團隊</p>
  </div>
</body>
</html>
  `.trim();
}

const preWrap = (text: string) => `<span style="white-space: pre-wrap">${escapeHtml(text)}</span>`;

interface RejectionItem {
  name: string;
  reason: string;
}

interface RejectionEmailData {
  email: string;
  items: RejectionItem[];
  showMySubmissions: boolean;
}

type ReviewSubject = '藝人' | '活動';

async function sendRejectionEmail(subject: ReviewSubject, data: RejectionEmailData): Promise<void> {
  if (!hasResendKey) {
    console.warn('RESEND_API_KEY not configured, skipping email');
    return;
  }

  const { email, items, showMySubmissions } = data;
  if (isWhitelisted(email)) return;

  const isSingle = items.length === 1;
  const mailSubject = isSingle
    ? `[STELLAR] 你投稿的${subject}「${items[0].name}」沒有通過審核`
    : `[STELLAR] 你投稿的${subject}沒有通過審核`;

  const namesText = items.map(i => escapeHtml(i.name)).join('、');
  // Admin batch rejects share one reason, so it's normally written once
  const sharedReason = items.every(i => i.reason === items[0].reason);
  const reasonHtml = sharedReason
    ? preWrap(items[0].reason)
    : items.map(i => preWrap(`${i.name}：${i.reason}`)).join('<br>');
  const resubmitLine = showMySubmissions
    ? `\n\n    <p>修改後可以到「我的投稿」編輯並重新送審：<a href="${MY_SUBMISSIONS_URL}">${MY_SUBMISSIONS_URL}</a></p>`
    : '';

  const html = renderLayout(`    <p>你好～</p>

    <p>非常感謝你在 STELLAR 上投稿 <strong>${namesText}</strong>！這次的投稿暫時沒有通過審核，原因是：</p>

    <p>${reasonHtml}</p>${resubmitLine}`);

  try {
    await sendEmail({
      from: 'STELLAR <noreply@stellar-zone.com>',
      to: email,
      subject: mailSubject,
      html,
    });
    console.log(`[email] ${subject} rejection sent (${items.length} item(s))`);
  } catch (err) {
    console.error(`[email] failed to send ${subject} rejection:`, redactEmails(String(err)));
  }
}

async function sendRejectionEmails(
  subject: ReviewSubject,
  rows: Array<{ createdByEmail?: string; createdBy: string; name: string; reason: string }>,
  isAnonymousUser: (userId: string) => Promise<boolean>
): Promise<void> {
  if (!hasResendKey) {
    console.warn('RESEND_API_KEY not configured, skipping emails');
    return;
  }

  const groups = new Map<string, { items: RejectionItem[]; userIds: Set<string> }>();
  for (const row of rows) {
    if (!row.createdByEmail) continue;
    const group = groups.get(row.createdByEmail) ?? { items: [], userIds: new Set<string>() };
    group.items.push({ name: row.name, reason: row.reason });
    group.userIds.add(row.createdBy);
    groups.set(row.createdByEmail, group);
  }

  // One lookup per uid per call
  const lookups = new Map<string, Promise<boolean>>();
  const isAnonymous = (uid: string) => {
    if (!lookups.has(uid)) lookups.set(uid, isAnonymousUser(uid));
    return lookups.get(uid)!;
  };

  for (const [email, { items, userIds }] of groups) {
    const anonymity = await Promise.all([...userIds].map(isAnonymous));
    await sendRejectionEmail(subject, {
      email,
      items,
      showMySubmissions: !anonymity.some(Boolean),
    });
  }
}

export const sendArtistRejectionEmail = (data: RejectionEmailData) =>
  sendRejectionEmail('藝人', data);

export const sendEventRejectionEmail = (data: RejectionEmailData) =>
  sendRejectionEmail('活動', data);

export function sendArtistRejectionEmails(
  artists: Array<{ createdByEmail?: string; createdBy: string; stageName: string; reason: string }>,
  isAnonymousUser: (userId: string) => Promise<boolean>
): Promise<void> {
  return sendRejectionEmails(
    '藝人',
    artists.map(a => ({ ...a, name: a.stageName })),
    isAnonymousUser
  );
}

export function sendEventRejectionEmails(
  events: Array<{ createdByEmail?: string; createdBy: string; title: string; reason: string }>,
  isAnonymousUser: (userId: string) => Promise<boolean>
): Promise<void> {
  return sendRejectionEmails(
    '活動',
    events.map(e => ({ ...e, name: e.title })),
    isAnonymousUser
  );
}

// Deliberately no reason: the frontend's "藝人已存在" text is not a rejection reason
export async function sendArtistExistsEmail(data: {
  email: string;
  names: string[];
}): Promise<void> {
  if (!hasResendKey) {
    console.warn('RESEND_API_KEY not configured, skipping email');
    return;
  }

  const { email, names } = data;
  if (isWhitelisted(email)) return;

  const subject =
    names.length === 1
      ? `[STELLAR] 你投稿的藝人「${names[0]}」已經在平台上囉`
      : `[STELLAR] 你投稿的藝人已經在平台上囉`;

  const html = renderLayout(`    <p>你好～</p>

    <p>謝謝你投稿 <strong>${names.map(escapeHtml).join('、')}</strong>！我們發現平台上已經有這位藝人/團體了，這筆投稿就不會重複上架囉！</p>

    <p>直接到首頁搜尋，就可以為他新增生咖囉：<a href="https://www.stellar-zone.com">https://www.stellar-zone.com</a></p>`);

  try {
    await sendEmail({ from: 'STELLAR <noreply@stellar-zone.com>', to: email, subject, html });
    console.log(`[email] artist exists sent (${names.length} item(s))`);
  } catch (err) {
    console.error(`[email] failed to send artist exists:`, redactEmails(String(err)));
  }
}

export async function sendArtistExistsEmails(
  artists: Array<{ createdByEmail?: string; stageName: string }>
): Promise<void> {
  if (!hasResendKey) {
    console.warn('RESEND_API_KEY not configured, skipping emails');
    return;
  }

  const groups = new Map<string, string[]>();
  for (const artist of artists) {
    if (!artist.createdByEmail) continue;
    groups.set(artist.createdByEmail, [
      ...(groups.get(artist.createdByEmail) ?? []),
      artist.stageName,
    ]);
  }

  for (const [email, names] of groups) {
    await sendArtistExistsEmail({ email, names });
  }
}
