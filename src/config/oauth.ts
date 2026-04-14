export const oauthConfig = {
  threads: {
    get clientId() {
      return process.env.META_APP_ID || '';
    },
    get clientSecret() {
      return process.env.META_APP_SECRET || '';
    },
    authorizationUrl: 'https://threads.net/oauth/authorize',
    tokenUrl: 'https://graph.threads.net/oauth/access_token',
    userInfoUrl: 'https://graph.threads.net/v1.0/me',
    get redirectUri() {
      return `${process.env.OAUTH_CALLBACK_BASE_URL || ''}/auth/threads/callback`;
    },
    scope: 'threads_basic',
  },
  get frontendUrl() {
    return process.env.FRONTEND_URL || 'https://www.stellar-zone.com';
  },
};
