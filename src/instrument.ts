import * as Sentry from '@sentry/node';
import { redactSentryEvent } from './utils/sentryRedaction';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
  enabled: process.env.NODE_ENV === 'production' || !!process.env.SENTRY_ENVIRONMENT,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1,
  // 座標（sort=distance 的 lat/lng）不應外流到 Sentry——即使前端已把座標四捨五入到
  // 小數第 3 位，仍是可追蹤到大致位置的個資。遮蔽後仍回傳 event（不回傳 null），
  // 錯誤/效能事件照常回報，只是拿掉座標本身。見 src/utils/sentryRedaction.ts。
  beforeSend(event) {
    return redactSentryEvent(event);
  },
  beforeSendTransaction(event) {
    return redactSentryEvent(event);
  },
});
