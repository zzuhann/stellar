/**
 * STELLAR - Backfill Step 2
 * 讀取人工確認後的 event-place-ids.csv，批次把 location.placeId 寫回 coffeeEvents
 *
 * 使用方式：
 *   1. 確認 event-place-ids.csv 在同目錄，且 placeId 欄位都已填好
 *   2. 確認 .env 已設定 FIREBASE_PROJECT_ID / FIREBASE_PRIVATE_KEY / FIREBASE_CLIENT_EMAIL
 *   3. npx ts-node src/scripts/backfill-event-place-ids.ts
 *
 * 注意：
 *   - placeId 欄位為空的列會被跳過
 *   - 只寫入 location.placeId，不寫 venueId（venueId 等新場地建好、審核通過後由 onVenueApproved 自動填）
 *   - 已有 placeId 的活動不在 CSV 中（export 時已跳過）
 */

import dotenv from 'dotenv';
dotenv.config();

import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';

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

interface EventPlaceIdRow {
  eventId: string;
  title: string;
  artistNames: string;
  locationName: string;
  locationAddress: string;
  currentPlaceId: string;
  currentVenueId: string;
  matchedVenueName: string;
  placeId: string;
  confidence: string;
}

function readCsv(filePath: string): Promise<EventPlaceIdRow[]> {
  return new Promise((resolve, reject) => {
    const rows: EventPlaceIdRow[] = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row: EventPlaceIdRow) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

// Firestore batch limit is 500 operations
const BATCH_SIZE = 400;

async function main(): Promise<void> {
  const inputPath = path.join(__dirname, 'event-place-ids.csv');

  if (!fs.existsSync(inputPath)) {
    console.error('❌ 找不到 event-place-ids.csv');
    process.exit(1);
  }

  const rows = await readCsv(inputPath);
  console.warn(`📋 讀取 CSV：${rows.length} 筆`);

  const toWrite = rows.filter(r => r.placeId && r.placeId.trim() !== '');
  const skipped = rows.length - toWrite.length;

  console.warn(`✅ 準備寫入：${toWrite.length} 筆`);
  console.warn(`⏭️  略過（placeId 為空）：${skipped} 筆\n`);

  if (toWrite.length === 0) {
    console.warn('沒有需要寫入的資料。');
    return;
  }

  let written = 0;
  let failed = 0;

  // Process in batches
  for (let i = 0; i < toWrite.length; i += BATCH_SIZE) {
    const chunk = toWrite.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (const row of chunk) {
      const ref = db.collection('coffeeEvents').doc(row.eventId);
      batch.update(ref, {
        'location.placeId': row.placeId.trim(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    try {
      await batch.commit();
      written += chunk.length;
      console.warn(`  ✅ 批次 ${Math.floor(i / BATCH_SIZE) + 1}：${chunk.length} 筆`);
    } catch (err) {
      failed += chunk.length;
      console.error(`  ❌ 批次 ${Math.floor(i / BATCH_SIZE) + 1} 失敗：`, err);
    }
  }

  console.warn(`\n🎉 完成！寫入 ${written} 筆，失敗 ${failed} 筆`);

  if (written > 0) {
    console.warn(`\n👉 下一步：`);
    console.warn(`   1. 到 Firebase Console 抽查幾筆 coffeeEvents，確認 location.placeId 正確`);
    console.warn(`   2. 建立新場地資料（新欄位格式）`);
    console.warn(`   3. 批次審核場地通過 → onVenueApproved 自動填 eventRefs + location.venueId`);
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ 錯誤：', err);
    process.exit(1);
  });
