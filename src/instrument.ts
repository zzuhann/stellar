import * as Sentry from '@sentry/node';
import { redactSentryEvent } from './utils/sentryRedaction';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
  enabled: process.env.NODE_ENV === 'production' || !!process.env.SENTRY_ENVIRONMENT,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1,
  // 使用者座標是個資，送出前遮蔽；仍回傳 event 讓錯誤照常回報
  beforeSend(event) {
    return redactSentryEvent(event);
  },
  beforeSendTransaction(event) {
    return redactSentryEvent(event);
  },
});
