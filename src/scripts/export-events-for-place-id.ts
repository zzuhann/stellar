/**
 * STELLAR - Backfill Step 1
 * 從 Firestore 抓所有 coffeeEvents，對每筆地點打 Google Places API 查詢 placeId
 * 輸出：event-place-ids.csv
 *
 * 使用方式：
 *   1. 確認 .env 已設定：
 *      - FIREBASE_PROJECT_ID / FIREBASE_PRIVATE_KEY / FIREBASE_CLIENT_EMAIL
 *      - GOOGLE_MAPS_API_KEY
 *      - FRONTEND_URL（用於 Referer header，可填 https://www.stellar-zone.com）
 *   2. npx ts-node src/scripts/export-events-for-place-id.ts
 *
 * 輸出欄位：
 *   - eventId, title, artistNames：活動基本資訊
 *   - locationName, locationAddress：活動地點（用來查詢 API）
 *   - currentPlaceId：目前 Firestore 中已有的 placeId（若已有則跳過 API）
 *   - placeId：API 查到的結果（或手動填入）；空白 = 查無結果，請人工補齊
 *   - confidence：found（API 有結果）/ skipped（原本就有 placeId）/ none（API 查無）
 *
 * 下一步：確認 CSV 後執行 backfill-event-place-ids.ts 寫回 Firestore
 */

import dotenv from 'dotenv';
dotenv.config();

import admin from 'firebase-admin';
import { createObjectCsvWriter } from 'csv-writer';
import path from 'path';

const { FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL, GOOGLE_MAPS_API_KEY } =
  process.env;

if (!FIREBASE_PROJECT_ID || !FIREBASE_PRIVATE_KEY || !FIREBASE_CLIENT_EMAIL) {
  console.error('缺少 Firebase 環境變數，請確認 .env 設定');
  process.exit(1);
}
if (!GOOGLE_MAPS_API_KEY) {
  console.error('缺少 GOOGLE_MAPS_API_KEY，請確認 .env 設定');
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

interface PlacesApiResponse {
  places?: Array<{ id: string }>;
}

async function findPlaceId(name: string, address: string): Promise<string | null> {
  const query = [name, address].filter(Boolean).join(' ');
  if (!query.trim()) return null;

  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY!,
      'X-Goog-FieldMask': 'places.id',
      Referer: process.env.FRONTEND_URL ?? 'https://www.stellar-zone.com',
    },
    body: JSON.stringify({
      textQuery: query,
      languageCode: 'zh-TW',
      regionCode: 'tw',
      maxResultCount: 1,
    }),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

  const data = (await res.json()) as PlacesApiResponse;
  return data.places?.[0]?.id ?? null;
}

async function main(): Promise<void> {
  console.warn('📖 讀取 coffeeEvents...');
  const eventsSnap = await db.collection('coffeeEvents').get();
  console.warn(`  共 ${eventsSnap.size} 筆活動\n`);

  interface OutputRow {
    eventId: string;
    title: string;
    artistNames: string;
    locationName: string;
    locationAddress: string;
    currentPlaceId: string;
    placeId: string;
    confidence: string;
  }

  const rows: OutputRow[] = [];
  let foundCount = 0;
  let noneCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (let i = 0; i < eventsSnap.docs.length; i++) {
    const doc = eventsSnap.docs[i];
    const d = doc.data();
    const location = d.location ?? {};
    const locationName: string = location.name ?? '';
    const locationAddress: string = location.address ?? location.formattedAddress ?? '';
    const currentPlaceId: string = location.placeId ?? location.place_id ?? '';
    const artists = (d.artists ?? []) as Array<{ name?: string }>;
    const artistNames = artists.map(a => a.name ?? '').join(' x ');

    process.stderr.write(`[${i + 1}/${eventsSnap.size}] ${d.title ?? ''} ... `);

    // Already has placeId — include in CSV but mark as skipped
    if (currentPlaceId) {
      process.stderr.write(`⏭️  已有 placeId\n`);
      skippedCount++;
      rows.push({
        eventId: doc.id,
        title: d.title ?? '',
        artistNames,
        locationName,
        locationAddress,
        currentPlaceId,
        placeId: currentPlaceId,
        confidence: 'skipped',
      });
      continue;
    }

    // Call Google Places API
    let placeId = '';
    let confidence = 'none';

    try {
      const result = await findPlaceId(locationName, locationAddress);
      if (result) {
        placeId = result;
        confidence = 'found';
        foundCount++;
        process.stderr.write(`✅ ${placeId}\n`);
      } else {
        noneCount++;
        process.stderr.write(`❌ 查無結果\n`);
      }
    } catch (err) {
      errorCount++;
      confidence = 'error';
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`⚠️  API 錯誤：${msg}\n`);
    }

    rows.push({
      eventId: doc.id,
      title: d.title ?? '',
      artistNames,
      locationName,
      locationAddress,
      currentPlaceId,
      placeId,
      confidence,
    });

    // Avoid hitting rate limits
    await new Promise<void>(r => setTimeout(r, 200));
  }

  console.warn(`\n📊 結果：`);
  console.warn(`  ✅ API 找到：${foundCount} 筆`);
  console.warn(`  ❌ 查無結果（請人工補）：${noneCount} 筆`);
  console.warn(`  ⏭️  已有 placeId（跳過）：${skippedCount} 筆`);
  if (errorCount > 0) console.warn(`  ⚠️  API 錯誤：${errorCount} 筆`);

  const outputPath = path.join(__dirname, 'event-place-ids.csv');
  const writer = createObjectCsvWriter({
    path: outputPath,
    header: [
      { id: 'eventId', title: 'eventId' },
      { id: 'title', title: 'title' },
      { id: 'artistNames', title: 'artistNames' },
      { id: 'locationName', title: 'locationName' },
      { id: 'locationAddress', title: 'locationAddress' },
      { id: 'currentPlaceId', title: 'currentPlaceId' },
      { id: 'placeId', title: 'placeId' },
      { id: 'confidence', title: 'confidence' },
    ],
  });

  await writer.writeRecords(rows);
  console.warn(`\n✅ 輸出完成：${outputPath}`);
  console.warn(`\n👉 下一步：`);
  console.warn(`   1. 打開 event-place-ids.csv，補齊 confidence=none 的 placeId 欄位`);
  console.warn(`   2. 確認 confidence=found 的結果是否正確`);
  console.warn(`   3. 執行 npx ts-node src/scripts/backfill-event-place-ids.ts`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ 錯誤：', err);
    process.exit(1);
  });
