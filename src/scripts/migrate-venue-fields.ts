/**
 * STELLAR - Migration
 * 更新 venues collection 欄位：刪除舊欄位、補上新欄位
 *
 * 使用方式：
 *   npx ts-node src/scripts/migrate-venue-fields.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import admin from 'firebase-admin';

const { FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL } = process.env;

if (!FIREBASE_PROJECT_ID || !FIREBASE_PRIVATE_KEY || !FIREBASE_CLIENT_EMAIL) {
  console.error('缺少 Firebase 環境變數，請確認 .env 設定');
  process.exit(1);
}

const privateKey = FIREBASE_PRIVATE_KEY.replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: FIREBASE_PROJECT_ID,
      privateKey,
      clientEmail: FIREBASE_CLIENT_EMAIL,
    }),
  });
}

const db = admin.firestore();

const FIELDS_TO_DELETE = [
  'cancel_policy',
  'custom_items',
  'decoration_allowed',
  'equipment',
  'noise_ok',
  'price_model',
  'price_note',
  'venue_visit_ok',
];

async function main(): Promise<void> {
  const snapshot = await db.collection('venues').get();
  console.log(`📋 找到 ${snapshot.docs.length} 筆場地`);

  const BATCH_SIZE = 500;
  let updated = 0;

  for (let i = 0; i < snapshot.docs.length; i += BATCH_SIZE) {
    const chunk = snapshot.docs.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (const doc of chunk) {
      const d = doc.data();

      const update: Record<string, unknown> = {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      for (const field of FIELDS_TO_DELETE) {
        if (field in d) {
          update[field] = admin.firestore.FieldValue.delete();
        }
      }

      if (!('description' in d)) {
        update['description'] = '';
      }

      if (!('otherPhotos' in d)) {
        update['otherPhotos'] = [];
      }

      if (d['coverPhoto'] !== '') {
        update['coverPhoto'] = '';
      }

      if (Object.keys(update).length > 1) {
        batch.update(doc.ref, update);
        updated++;
      }
    }

    await batch.commit();
    console.log(
      `  ✅ 已處理 ${Math.min(i + BATCH_SIZE, snapshot.docs.length)} / ${snapshot.docs.length}`
    );
  }

  console.log(`\n🎉 完成！共更新 ${updated} 筆`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ 錯誤：', err);
    process.exit(1);
  });
