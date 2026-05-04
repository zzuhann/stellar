/**
 * Backfill script：為所有現有 artists 補生成 slug
 *
 * 執行方式：
 *   npx ts-node src/scripts/backfillArtistSlugs.ts
 *
 * 注意：執行前請確認 .env 已設定 FIREBASE_PROJECT_ID / FIREBASE_PRIVATE_KEY / FIREBASE_CLIENT_EMAIL
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
db.settings({ ignoreUndefinedProperties: true });

// slug 結尾是 -數字 表示舊策略產生的，需要重新生成
const isNumericSuffix = (slug: string) => /-\d+$/.test(slug);

function generateSlugFromName(stageName: string): string {
  return stageName
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function generateUniqueSlug(
  collection: admin.firestore.CollectionReference,
  stageName: string,
  docId: string
): Promise<string> {
  const baseSlug = generateSlugFromName(stageName);

  const existing = await collection.where('slug', '==', baseSlug).limit(1).get();
  const takenByOther = existing.docs.some(d => d.id !== docId);
  if (!takenByOther) {
    return baseSlug;
  }

  // 衝突時用 doc ID 前 6 碼作為 suffix
  return `${baseSlug}-${docId.substring(0, 6).toLowerCase()}`;
}

async function run(): Promise<void> {
  const collection = db.collection('artists');
  const snapshot = await collection.get();

  const docs = snapshot.docs;
  console.log(`共找到 ${docs.length} 位藝人`);

  let updated = 0;
  let skipped = 0;

  for (const doc of docs) {
    const data = doc.data();

    // 已有 slug 且不是舊的 -數字 格式，跳過
    if (data.slug && !isNumericSuffix(data.slug)) {
      skipped++;
      continue;
    }

    const stageName = data.stageName as string;
    if (!stageName) {
      console.warn(`  [SKIP] ${doc.id} 沒有 stageName，跳過`);
      skipped++;
      continue;
    }

    const oldSlug = data.slug ?? '（無）';
    const slug = await generateUniqueSlug(collection, stageName, doc.id);
    await doc.ref.update({ slug, updatedAt: admin.firestore.Timestamp.now() });
    console.log(`  [OK] ${stageName}：${oldSlug} → ${slug}`);
    updated++;
  }

  console.log(`\n完成。更新：${updated}，跳過（slug 已正常）：${skipped}`);
}

run()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Backfill 失敗:', err);
    process.exit(1);
  });
