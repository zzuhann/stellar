// 測試環境設定
process.env.NODE_ENV = 'test';
process.env.PORT = '3002';

// 模擬 Firebase 設定（避免在測試中連接真實 Firebase）
process.env.FIREBASE_PROJECT_ID = 'test-project';
process.env.FIREBASE_PRIVATE_KEY_ID = 'test-key-id';
process.env.FIREBASE_PRIVATE_KEY = '"-----BEGIN PRIVATE KEY-----\\nMOCK_PRIVATE_KEY\\n-----END PRIVATE KEY-----\\n"';
process.env.FIREBASE_CLIENT_EMAIL = 'test@test-project.iam.gserviceaccount.com';
process.env.FIREBASE_CLIENT_ID = '123456789012345678901';
process.env.FIREBASE_AUTH_URI = 'https://accounts.google.com/o/oauth2/auth';
process.env.FIREBASE_TOKEN_URI = 'https://oauth2.googleapis.com/token';

// 全域測試超時
jest.setTimeout(10000);