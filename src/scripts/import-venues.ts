/**
 * STELLAR - Phase 0 Step 3
 * 把人工確認後的 CSV 批次寫入 Firestore venues collection
 *
 * 使用方式：
 *   1. 確保 venue-candidates-with-place-id.csv 在同目錄（Step 2 產出，人工確認後）
 *   2. 確認 .env 已設定 FIREBASE_PROJECT_ID / FIREBASE_PRIVATE_KEY / FIREBASE_CLIENT_EMAIL
 *   3. npx ts-node src/scripts/import-venues.ts
 *
 * 注意：confidence=none 的欄位會被跳過，不寫入
 */

import dotenv from 'dotenv';
dotenv.config();

import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';

// ─── Firebase 初始化 ──────────────────────────────────────────────────────────

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

// ─── Types ────────────────────────────────────────────────────────────────────

interface VenueCandidateRow {
  cluster_id: string;
  venueName: string;
  address: string;
  lat: string;
  lng: string;
  event_count: string;
  event_ids: string;
  place_id: string;
  google_lat: string;
  google_lng: string;
  distance_m: string;
  confidence: string;
  city: string;
}

// ─── 根據地址判斷 region ──────────────────────────────────────────────────────

function detectRegion(city: string): string {
  return city.length >= 2 ? city.slice(0, 2) : city;
}

// ─── 讀取 CSV ─────────────────────────────────────────────────────────────────

function readCsv(filePath: string): Promise<VenueCandidateRow[]> {
  return new Promise((resolve, reject) => {
    const rows: VenueCandidateRow[] = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row: VenueCandidateRow) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

// ─── 主程式 ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const inputPath = path.join(__dirname, 'venue-candidates-with-place-id.csv');

  if (!fs.existsSync(inputPath)) {
    console.error('❌ 找不到 venue-candidates-with-place-id.csv');
    process.exit(1);
  }

  const rows = await readCsv(inputPath);
  console.log(`📋 讀取 CSV：${rows.length} 筆`);

  const toImport = rows.filter(r => r.confidence === 'high' || r.confidence === 'low');
  const skipped = rows.length - toImport.length;

  console.log(`✅ 準備寫入：${toImport.length} 筆`);
  console.log(`⏭️  略過（confidence=none）：${skipped} 筆\n`);

  const venuesRef = db.collection('venues');
  const batch = db.batch();
  const now = admin.firestore.FieldValue.serverTimestamp();

  for (const row of toImport) {
    const eventIds = row.event_ids ? row.event_ids.split('|').filter(Boolean) : [];
    const eventRefs = eventIds.map(id => db.collection('coffeeEvents').doc(id));

    const docRef = venuesRef.doc(row.cluster_id);

    batch.set(docRef, {
      coverPhoto: '',
      name: row.venueName ?? '',
      address: row.address ?? '',
      region: row.city ? detectRegion(row.city) : detectRegion(row.address ?? ''),
      lat: parseFloat(row.lat) || 0,
      lng: parseFloat(row.lng) || 0,
      place_id: row.place_id ?? '',
      nearest_mrt: '',
      mrt_walk_minutes: null,
      capacity_max: null,
      equipment: [],
      decoration_allowed: [],
      custom_items: [],
      price_model: '',
      price_note: '',
      venue_visit_ok: null,
      cancel_policy: '',
      noise_ok: null,
      host_tags: [],
      eventCount: parseInt(row.event_count) || 0,
      eventRefs,
      createdAt: now,
      updatedAt: now,
    });

    console.log(`  ✅ ${row.venueName} (${row.event_count} 場, ${row.confidence})`);
  }

  console.log(`\n📤 寫入 Firestore...`);
  await batch.commit();

  console.log(`\n🎉 完成！成功寫入 ${toImport.length} 筆場地資料到 venues collection`);
  console.log(`\n👉 下一步：`);
  console.log(`   1. 到 Firebase Console 確認 venues collection 資料正確`);
  console.log(`   2. 建立 Firestore Index（region, eventCount, capacity_max）`);
  console.log(`   3. 開始開發 GET /api/venues API`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ 錯誤：', err);
    process.exit(1);
  });
