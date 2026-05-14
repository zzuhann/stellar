/**
 * STELLAR - Phase 0 Step 1
 * 從 coffeeEvents 掃活動資料，用 proximity clustering 找候選場地
 * 輸出：venue-candidates.csv（辦過 ≥2 筆活動的場地清單）
 *
 * 使用方式：
 *   1. 確認 .env 已設定 FIREBASE_PROJECT_ID / FIREBASE_PRIVATE_KEY / FIREBASE_CLIENT_EMAIL
 *   2. npx ts-node src/scripts/find-venue-candidates.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import admin from 'firebase-admin';
import { createObjectCsvWriter } from 'csv-writer';
import path from 'path';

interface EventRecord {
  eventId: string;
  venueName: string;
  address: string;
  lat: number;
  lng: number;
}

interface Centroid {
  lat: number;
  lng: number;
}

interface Cluster {
  centroid: Centroid;
  events: EventRecord[];
}

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

// ─── Haversine 公式：計算兩個經緯度之間的距離（公尺）────────────────────────

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

// ─── Proximity Clustering ────────────────────────────────────────────────────

const THRESHOLD_METERS = 50;

function clusterByProximity(events: EventRecord[]): Cluster[] {
  const clusters: Cluster[] = [];

  for (const event of events) {
    const { lat, lng } = event;

    let foundCluster: Cluster | null = null;

    for (const cluster of clusters) {
      const dist = haversineDistance(lat, lng, cluster.centroid.lat, cluster.centroid.lng);
      if (dist < THRESHOLD_METERS) {
        foundCluster = cluster;
        break;
      }
    }

    if (foundCluster) {
      foundCluster.events.push(event);
      const n = foundCluster.events.length;
      foundCluster.centroid = {
        lat: foundCluster.events.reduce((sum, e) => sum + e.lat, 0) / n,
        lng: foundCluster.events.reduce((sum, e) => sum + e.lng, 0) / n,
      };
    } else {
      clusters.push({
        centroid: { lat, lng },
        events: [event],
      });
    }
  }

  return clusters;
}

// ─── 找最常出現的場地名稱 / 地址 ──────────────────────────────────────────────

function getMostFrequent(
  events: EventRecord[],
  key: keyof Pick<EventRecord, 'venueName' | 'address'>
): string {
  const counts: Record<string, number> = {};
  for (const e of events) {
    const val = e[key];
    if (val) counts[val] = (counts[val] ?? 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

// ─── 主程式 ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('📡 讀取 coffeeEvents...');

  const snapshot = await db.collection('coffeeEvents').get();
  console.log(`✅ 共讀取 ${snapshot.size} 筆活動`);

  const events: EventRecord[] = [];
  let skipped = 0;

  snapshot.forEach(doc => {
    const data = doc.data();
    const lat = data.location?.coordinates?.lat as number | undefined;
    const lng = data.location?.coordinates?.lng as number | undefined;

    if (lat == null || lng == null) {
      skipped++;
      return;
    }

    events.push({
      eventId: doc.id,
      venueName: (data.location?.name as string | undefined) ?? '',
      address: (data.location?.address as string | undefined) ?? '',
      lat,
      lng,
    });
  });

  console.log(`⚠️  略過沒有經緯度的活動：${skipped} 筆`);
  console.log(`🗺️  開始 proximity clustering（threshold: ${THRESHOLD_METERS}m）...`);

  const clusters = clusterByProximity(events);
  console.log(`📍 共找到 ${clusters.length} 個 cluster`);

  const candidates = clusters
    .filter(c => c.events.length >= 2)
    .sort((a, b) => b.events.length - a.events.length);

  console.log(`🎯 辦過 ≥2 筆活動的候選場地：${candidates.length} 個`);

  const outputPath = path.join(__dirname, 'venue-candidates.csv');
  const csvWriter = createObjectCsvWriter({
    path: outputPath,
    header: [
      { id: 'cluster_id', title: 'cluster_id' },
      { id: 'venueName', title: 'venueName' },
      { id: 'address', title: 'address' },
      { id: 'lat', title: 'lat' },
      { id: 'lng', title: 'lng' },
      { id: 'event_count', title: 'event_count' },
      { id: 'event_ids', title: 'event_ids' },
    ],
  });

  const rows = candidates.map((cluster, index) => ({
    cluster_id: `C${String(index + 1).padStart(3, '0')}`,
    venueName: getMostFrequent(cluster.events, 'venueName'),
    address: getMostFrequent(cluster.events, 'address'),
    lat: cluster.centroid.lat.toFixed(6),
    lng: cluster.centroid.lng.toFixed(6),
    event_count: cluster.events.length,
    event_ids: cluster.events.map(e => e.eventId).join('|'),
  }));

  await csvWriter.writeRecords(rows);

  console.log(`\n✅ 完成！輸出檔案：venue-candidates.csv`);
  console.log(`   共 ${rows.length} 個候選場地`);
  console.log(`   最多活動的場地：${rows[0]?.venueName}（${rows[0]?.event_count} 場）`);
  console.log(`\n👉 下一步：把 venue-candidates.csv 餵給 find-place-ids.ts`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ 錯誤：', err);
    process.exit(1);
  });
