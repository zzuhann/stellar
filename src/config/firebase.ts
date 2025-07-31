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
// 暫時移除 storage，保留未來擴充可能
// let storage: admin.storage.Bucket;

if (hasFirebaseConfig) {
  const serviceAccount = {
    type: 'service_account',
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: process.env.FIREBASE_AUTH_URI,
    token_uri: process.env.FIREBASE_TOKEN_URI,
  };

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
      // 暫時移除 storageBucket 設定
      // storageBucket: `${process.env.FIREBASE_PROJECT_ID}.appspot.com`
    });
  }

  db = admin.firestore();
  auth = admin.auth();
  // storage = admin.storage().bucket();
} else {
  console.warn('⚠️  Firebase configuration not found. Some features will be disabled.');

  // 創建空的 mock 物件避免錯誤
  db = null;
  auth = null;
  // storage = null;
}

export { db, auth, hasFirebaseConfig };
// 未來需要時再加回 storage
export default admin;
