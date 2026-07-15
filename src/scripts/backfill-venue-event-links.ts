/**
 * STELLAR - Backfill: 補回已 approve 活動與場地的關聯
 *
 * 背景：
 *   eventService.linkEventToVenue 過去查詢 venues 用錯欄位名稱（place_id 而非 placeId），
 *   導致活動 approve 時的場地連結從未真正寫入。這支腳本重新比對所有 status === 'approved'
 *   且 location.placeId 有值的活動，補回場地的 eventRefs / eventCount 與活動的
 *   location.venueId。
 *
 * 使用方式：
 *   1. 確認 .env 已設定 FIREBASE_PROJECT_ID / FIREBASE_PRIVATE_KEY / FIREBASE_CLIENT_EMAIL
 *   2. 先跑 dry-run，確認會更新的清單（不加 flag 或加 --dry-run 都是 dry-run）：
 *        npx tsx src/scripts/backfill-venue-event-links.ts
 *   3. 確認清單無誤後，加上 --commit 才會真的寫入：
 *        npx tsx src/scripts/backfill-venue-event-links.ts --commit
 *
 * 注意：
 *   - 這支腳本會對生產資料做批次寫入，預設一律 dry-run，只有明確帶 --commit 才會寫入
 *   - 每筆活動只會被連結一次（比對場地現有 eventRefs，避免重複計算 eventCount）
 */

import dotenv from 'dotenv';
dotenv.config();

import { db, hasFirebaseConfig } from '../config/firebase';
import { DocumentReference, FieldValue } from 'firebase-admin/firestore';

const isCommit = process.argv.includes('--commit');

interface Candidate {
  eventId: string;
  eventTitle: string;
  placeId: string;
  linkedVenueId?: string;
}

interface VenueLinkInfo {
  venueId: string;
  venueName: string;
  ref: DocumentReference;
  linkedEventIds: Set<string>;
}

export type BackfillAction = 'skip' | 'link-both' | 'repair-event';

export function determineBackfillAction(
  hasVenueRef: boolean,
  linkedVenueId: string | undefined,
  targetVenueId: string
): BackfillAction {
  if (hasVenueRef && linkedVenueId === targetVenueId) return 'skip';
  return hasVenueRef ? 'repair-event' : 'link-both';
}

async function main(): Promise<void> {
  if (!hasFirebaseConfig || !db) {
    console.error('缺少 Firebase 環境變數，請確認 .env 設定');
    process.exit(1);
  }

  console.log(`模式：${isCommit ? '⚠️  COMMIT（會寫入）' : 'DRY RUN（不會寫入）'}\n`);

  const snapshot = await db.collection('coffeeEvents').where('status', '==', 'approved').get();

  const candidates: Candidate[] = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const placeId: string | undefined = data.location?.placeId;
    if (placeId) {
      candidates.push({
        eventId: doc.id,
        eventTitle: data.title ?? '(無標題)',
        placeId,
        linkedVenueId: data.location?.venueId,
      });
    }
  }

  console.log(`掃到 ${candidates.length} 筆 approved 且有 location.placeId 的活動\n`);

  const venueCache = new Map<string, VenueLinkInfo | null>();

  let matched = 0;
  let updated = 0;
  let skippedNoVenue = 0;
  let skippedAlreadyLinked = 0;
  let repairedEventOnly = 0;

  for (const candidate of candidates) {
    let venue = venueCache.get(candidate.placeId);

    if (venue === undefined) {
      const venueSnapshot = await db
        .collection('venues')
        .where('placeId', '==', candidate.placeId)
        .limit(1)
        .get();

      if (venueSnapshot.empty) {
        venue = null;
      } else {
        const venueDoc = venueSnapshot.docs[0];
        const existingRefs: DocumentReference[] = venueDoc.data()?.eventRefs ?? [];
        venue = {
          venueId: venueDoc.id,
          venueName: venueDoc.data()?.name ?? '(無名稱)',
          ref: venueDoc.ref,
          linkedEventIds: new Set(existingRefs.map(ref => ref.id)),
        };
      }
      venueCache.set(candidate.placeId, venue);
    }

    if (!venue) {
      skippedNoVenue++;
      continue;
    }

    matched++;

    const action = determineBackfillAction(
      venue.linkedEventIds.has(candidate.eventId),
      candidate.linkedVenueId,
      venue.venueId
    );

    if (action === 'skip') {
      skippedAlreadyLinked++;
      continue;
    }

    console.log(
      `${isCommit ? '✅' : '👉'} ${action === 'repair-event' ? '補活動連結' : '連結兩端'}：活動「${candidate.eventTitle}」(${candidate.eventId}) → 場地「${venue.venueName}」(${venue.venueId})`
    );

    if (isCommit) {
      const venueRef = venue.ref;
      const eventRef = db.collection('coffeeEvents').doc(candidate.eventId);

      const txResult = await db.runTransaction(async tx => {
        const venueDoc = await tx.get(venueRef);
        if (!venueDoc.exists) return null;

        const existingRefs: DocumentReference[] = venueDoc.data()?.eventRefs ?? [];
        const alreadyLinked = existingRefs.some(ref => ref.id === candidate.eventId);
        if (!alreadyLinked) {
          tx.update(venueRef, {
            eventRefs: FieldValue.arrayUnion(eventRef),
            eventCount: FieldValue.increment(1),
          });
        }
        tx.update(eventRef, { 'location.venueId': venue!.venueId });
        return alreadyLinked ? 'repair-event' : 'link-both';
      });

      if (!txResult) continue;

      // 記錄本次執行內已處理過的連結，避免同一場地在同一次執行中被重複計算 eventCount
      venue.linkedEventIds.add(candidate.eventId);
      if (txResult === 'repair-event') repairedEventOnly++;
      updated++;
    } else {
      venue.linkedEventIds.add(candidate.eventId);
      if (action === 'repair-event') repairedEventOnly++;
      updated++;
    }
  }

  console.log('\n=== 統計 ===');
  console.log(`掃到待檢查活動：${candidates.length}`);
  console.log(`找到對應場地：${matched}`);
  console.log(`${isCommit ? '實際更新' : 'Dry-run 模擬更新'}：${updated}`);
  console.log(`其中僅修復活動 venueId：${repairedEventOnly}`);
  console.log(`跳過（找不到對應場地）：${skippedNoVenue}`);
  console.log(`跳過（已連結過）：${skippedAlreadyLinked}`);

  if (!isCommit && updated > 0) {
    console.log('\n這是 dry-run，尚未寫入。確認清單無誤後加上 --commit 執行：');
    console.log('  npx tsx src/scripts/backfill-venue-event-links.ts --commit');
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ 錯誤：', err);
      process.exit(1);
    });
}
