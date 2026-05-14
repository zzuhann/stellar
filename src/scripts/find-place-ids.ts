/**
 * STELLAR - Phase 0 Step 2
 * 對候選場地查詢 Google Places API，取得 place_id
 * 輸出：venue-candidates-with-place-id.csv
 *
 * 使用方式：
 *   1. 確保 venue-candidates.csv 在同目錄（Step 1 產出）
 *   2. 確認 .env 已設定 GOOGLE_MAPS_API_KEY
 *   3. npx ts-node src/scripts/find-place-ids.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { createObjectCsvWriter } from 'csv-writer';

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!API_KEY) {
  console.error('❌ 請在 .env 設定 GOOGLE_MAPS_API_KEY');
  process.exit(1);
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface VenueCandidate {
  cluster_id: string;
  venueName: string;
  address: string;
  lat: string;
  lng: string;
  event_count: string;
  event_ids: string;
}

type Confidence = 'high' | 'low' | 'none';

interface AddressComponent {
  longText: string;
  types: string[];
}

interface PlaceResult {
  id: string;
  location: {
    latitude: number;
    longitude: number;
  };
  displayName?: {
    text: string;
  };
  addressComponents?: AddressComponent[];
}

interface PlacesApiResponse {
  places?: PlaceResult[];
}

// ─── 信心度閾值 ───────────────────────────────────────────────────────────────

const HIGH_CONFIDENCE_METERS = 50;
const LOW_CONFIDENCE_METERS = 200;

// ─── Haversine 公式 ───────────────────────────────────────────────────────────

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Google Places findPlaceFromText ─────────────────────────────────────────

async function findPlace(venueName: string, address: string): Promise<PlacesApiResponse> {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'places.id,places.location,places.displayName,places.addressComponents',
      Referer: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    },
    body: JSON.stringify({
      textQuery: `${venueName} ${address}`,
      languageCode: 'zh-TW',
      regionCode: 'tw',
      maxResultCount: 1,
    }),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<PlacesApiResponse>;
}

// ─── 讀取 CSV ─────────────────────────────────────────────────────────────────

function readCsv(filePath: string): Promise<VenueCandidate[]> {
  return new Promise((resolve, reject) => {
    const rows: VenueCandidate[] = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row: VenueCandidate) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

// ─── 主程式 ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const inputPath = path.join(__dirname, 'venue-candidates.csv');

  if (!fs.existsSync(inputPath)) {
    console.error('❌ 找不到 venue-candidates.csv，請先執行 find-venue-candidates.ts');
    process.exit(1);
  }

  const candidates = await readCsv(inputPath);
  console.log(`📋 讀取候選場地：${candidates.length} 筆`);
  console.log(`🔍 開始查詢 Google Places API...\n`);

  const results: Array<
    VenueCandidate & {
      place_id: string;
      google_lat: string;
      google_lng: string;
      distance_m: number | '';
      confidence: Confidence;
      city: string;
    }
  > = [];

  let highCount = 0;
  let lowCount = 0;
  let noneCount = 0;

  for (let i = 0; i < candidates.length; i++) {
    const venue = candidates[i];
    const { cluster_id, venueName, address, lat, lng, event_count, event_ids } = venue;

    process.stdout.write(`[${i + 1}/${candidates.length}] ${venueName} ... `);

    let place_id = '';
    let google_lat = '';
    let google_lng = '';
    let distance_m: number | '' = '';
    let confidence: Confidence = 'none';
    let city = '';

    try {
      const response = await findPlace(venueName, address);

      if (response.places && response.places.length > 0) {
        const place = response.places[0];
        place_id = place.id ?? '';
        const gLat = place.location?.latitude;
        const gLng = place.location?.longitude;

        city =
          place.addressComponents?.find(c => c.types.includes('administrative_area_level_1'))
            ?.longText ?? '';

        if (gLat != null && gLng != null) {
          google_lat = String(gLat);
          google_lng = String(gLng);

          const dist = haversineDistance(parseFloat(lat), parseFloat(lng), gLat, gLng);
          distance_m = Math.round(dist);

          if (dist < HIGH_CONFIDENCE_METERS) {
            confidence = 'high';
            highCount++;
          } else if (dist < LOW_CONFIDENCE_METERS) {
            confidence = 'low';
            lowCount++;
          } else {
            confidence = 'none';
            noneCount++;
            place_id = '';
          }
        }
      } else {
        noneCount++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\n⚠️  查詢失敗：${message}`);
      noneCount++;
    }

    const confidenceEmoji: Record<Confidence, string> = { high: '✅', low: '⚠️ ', none: '❌' };
    console.log(
      `${confidenceEmoji[confidence]} ${confidence}${distance_m !== '' ? ` (${distance_m}m)` : ''}`
    );

    results.push({
      cluster_id,
      venueName,
      address,
      lat,
      lng,
      event_count,
      event_ids,
      place_id,
      google_lat,
      google_lng,
      distance_m,
      confidence,
      city,
    });

    await new Promise<void>(r => setTimeout(r, 200));
  }

  const outputPath = path.join(__dirname, 'venue-candidates-with-place-id.csv');
  const csvWriter = createObjectCsvWriter({
    path: outputPath,
    header: [
      { id: 'cluster_id', title: 'cluster_id' },
      { id: 'venueName', title: 'venueName' },
      { id: 'address', title: 'address' },
      { id: 'lat', title: 'lat' },
      { id: 'lng', title: 'lng' },
      { id: 'event_count', title: 'event_count' },
      { id: 'place_id', title: 'place_id' },
      { id: 'google_lat', title: 'google_lat' },
      { id: 'google_lng', title: 'google_lng' },
      { id: 'distance_m', title: 'distance_m' },
      { id: 'confidence', title: 'confidence' },
      { id: 'city', title: 'city' },
      { id: 'event_ids', title: 'event_ids' },
    ],
  });

  await csvWriter.writeRecords(results);

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`✅ 完成！輸出檔案：venue-candidates-with-place-id.csv`);
  console.log(`   ✅ high confidence（自動 match）：${highCount} 筆`);
  console.log(`   ⚠️  low confidence（需人工確認）：${lowCount} 筆`);
  console.log(`   ❌ 查無結果或距離太遠：${noneCount} 筆`);
  console.log(`\n👉 下一步：打開 CSV，人工確認 confidence=low 的欄位`);
  console.log(`   確認後執行 import-venues.ts 批次寫入 Firestore`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ 錯誤：', err);
    process.exit(1);
  });
