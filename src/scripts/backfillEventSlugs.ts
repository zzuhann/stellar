/**
 * Backfill script：為所有現有 events 補生成 slug
 *
 * 執行方式：
 *   npx ts-node src/scripts/backfillEventSlugs.ts
 *
 * 注意：執行前請確認 .env 已設定 FIREBASE_PROJECT_ID / FIREBASE_PRIVATE_KEY / FIREBASE_CLIENT_EMAIL
 */

import dotenv from 'dotenv';
dotenv.config();

import admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { generateEventSlug } from '../utils/eventSlug';

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
db.settings({ ignoreUndefinedProperties: true });

async function run(): Promise<void> {
  const eventsCollection = db.collection('coffeeEvents');
  const artistsCollection = db.collection('artists');

  const snapshot = await eventsCollection.get();
  const docs = snapshot.docs;
  console.log(`共找到 ${docs.length} 筆活動`);

  // 預先載入所有藝人的 slug（減少 Firestore 查詢次數）
  const artistSlugCache = new Map<string, string>();
  const artistsSnapshot = await artistsCollection.get();
  for (const artistDoc of artistsSnapshot.docs) {
    const data = artistDoc.data();
    artistSlugCache.set(
      artistDoc.id,
      (data.slug as string | undefined) || artistDoc.id.substring(0, 6).toLowerCase()
    );
  }
  console.log(`已載入 ${artistSlugCache.size} 位藝人的 slug`);

  let updated = 0;
  let skipped = 0;

  for (const doc of docs) {
    const data = doc.data();

    // 已有 slug 則跳過
    if (data.slug) {
      skipped++;
      continue;
    }

    const artists = data.artists as Array<{ id: string; name: string }> | undefined;
    if (!artists || artists.length === 0) {
      console.warn(`  [SKIP] ${doc.id} 沒有 artists，跳過`);
      skipped++;
      continue;
    }

    const startTimestamp = data.datetime?.start as Timestamp | undefined;
    if (!startTimestamp) {
      console.warn(`  [SKIP] ${doc.id} 沒有 datetime.start，跳過`);
      skipped++;
      continue;
    }

    const artistSlugsOrFallbacks = artists.map(
      artist => artistSlugCache.get(artist.id) ?? artist.id.substring(0, 6).toLowerCase()
    );

    const slug = generateEventSlug(artistSlugsOrFallbacks, startTimestamp, doc.id);
    await doc.ref.update({ slug, updatedAt: admin.firestore.Timestamp.now() });
    console.log(`  [OK] ${doc.id} → ${slug}`);
    updated++;
  }

  console.log(`\n完成。更新：${updated}，跳過（slug 已存在或資料不完整）：${skipped}`);
}

run()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Backfill 失敗:', err);
    process.exit(1);
  });
