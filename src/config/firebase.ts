import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

// 檢查是否有 Firebase 設定
const hasFirebaseConfig = !!(
  process.env.FIREBASE_PROJECT_ID &&
  process.env.FIREBASE_PRIVATE_KEY &&
  process.env.FIREBASE_CLIENT_EMAIL
);

let db: admin.firestore.Firestore | null;
let auth: admin.auth.Auth | null;

if (hasFirebaseConfig) {
  try {
    // 處理 private key 格式
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;
    if (privateKey) {
      // 移除開頭和結尾的引號
      privateKey = privateKey.replace(/^["']|["']$/g, '');
      // 處理換行符號
      privateKey = privateKey.replace(/\\n/g, '\n');
      // 確保 private key 格式正確
      if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
        throw new Error('Invalid private key format');
      }
    }

    const serviceAccount = {
      type: 'service_account',
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
      private_key: privateKey,
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      client_id: process.env.FIREBASE_CLIENT_ID,
      auth_uri: process.env.FIREBASE_AUTH_URI || 'https://accounts.google.com/o/oauth2/auth',
      token_uri: process.env.FIREBASE_TOKEN_URI || 'https://oauth2.googleapis.com/token',
    };

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
      });
    }

    db = admin.firestore();
    auth = admin.auth();
  } catch (error) {
    console.error('❌ Firebase initialization failed:', error);
    db = null;
    auth = null;
  }
} else {
  console.warn('⚠️  Firebase configuration not found. Some features will be disabled.');
  db = null;
  auth = null;
}

export { db, auth, hasFirebaseConfig };
export default admin;
