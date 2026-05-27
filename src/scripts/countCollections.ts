/**
 * 查詢各 collection 的總筆數
 *
 * 執行方式：
 *   npx ts-node src/scripts/countCollections.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import admin from 'firebase-admin';

const hasConfig = !!(
  process.env.FIREBASE_PROJECT_ID &&
  process.env.FIREBASE_PRIVATE_KEY &&
  process.env.FIREBASE_CLIENT_EMAIL
);

if (!hasConfig) {
  console.error('缺少 Firebase 環境變數，請確認 .env 設定');
  process.exit(1);
}

let privateKey = process.env.FIREBASE_PRIVATE_KEY!;
privateKey = privateKey.replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKey,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    }),
  });
}

const db = admin.firestore();

async function run(): Promise<void> {
  const collections = ['artists', 'coffeeEvents'];

  for (const name of collections) {
    const snapshot = await db.collection(name).count().get();
    console.log(`${name}: ${snapshot.data().count}`);
  }
}

run()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('查詢失敗:', err);
    process.exit(1);
  });
