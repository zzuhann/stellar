/**
 * STELLAR - Audit: 場地與活動連結一致性稽核（唯讀）
 *
 * 背景：
 *   既有的 backfill-venue-event-links.ts（含 --dry-run）只檢查「有 placeId 的 approved
 *   活動，能不能精確匹配到場地」，漏了三項稽核（見 specs/_backlog-venues.md）：
 *     1. 沒有 placeId 的 approved 活動有幾筆 —— 這些活動永遠不可能被連結，只是想知道規模
 *     2. 重複 placeId —— 是否有兩個以上不同的 venue 文件用了同一個 placeId（資料重複建檔的訊號）
 *     3. eventCount 一致性 —— 每個 venue 的 eventCount 欄位是否等於它自己 eventRefs 陣列的
 *        實際長度（同步機制如果哪裡漏執行，這兩個數字會兜不起來）
 *   這支腳本補上這三項，並順便重跑一次既有腳本「精確匹配 / 雙向連結」的檢查邏輯（直接複用
 *   determineBackfillAction），讓稽核報告涵蓋目前已知的所有缺口。
 *
 * 使用方式：
 *   1. 確認 .env 已設定 FIREBASE_PROJECT_ID / FIREBASE_PRIVATE_KEY / FIREBASE_CLIENT_EMAIL
 *   2. 執行：
 *        npx tsx src/scripts/audit-venue-event-links.ts
 *
 * 注意：
 *   - 這支腳本完全唯讀，不會呼叫任何 .update() / .set() / transaction 寫入，沒有 --commit 模式
 *   - 只印報告，不做任何資料修復；發現問題請另外用 backfill-venue-event-links.ts 或手動處理
 */

import dotenv from 'dotenv';
dotenv.config();

import { db, hasFirebaseConfig } from '../config/firebase';
import { DocumentReference } from 'firebase-admin/firestore';
import { determineBackfillAction } from './backfill-venue-event-links';

export interface DuplicatePlaceIdGroup {
  placeId: string;
  venues: { id: string; name: string }[];
}

/** 找出被兩個以上不同 venue 文件共用的 placeId（資料重複建檔的訊號）。 */
export function findDuplicatePlaceIds(
  venues: { id: string; name: string; placeId?: string }[]
): DuplicatePlaceIdGroup[] {
  const byPlaceId = new Map<string, { id: string; name: string }[]>();
  for (const venue of venues) {
    if (!venue.placeId) continue;
    const list = byPlaceId.get(venue.placeId) ?? [];
    list.push({ id: venue.id, name: venue.name });
    byPlaceId.set(venue.placeId, list);
  }
  return Array.from(byPlaceId.entries())
    .filter(([, list]) => list.length > 1)
    .map(([placeId, list]) => ({ placeId, venues: list }));
}

export interface EventCountMismatch {
  venueId: string;
  venueName: string;
  recordedEventCount: number;
  actualEventRefsLength: number;
}

/** 找出 venue.eventCount 欄位值跟 venue.eventRefs 實際長度兜不起來的場地。 */
export function findEventCountMismatches(
  venues: { id: string; name: string; eventCount: number; eventRefsLength: number }[]
): EventCountMismatch[] {
  return venues
    .filter(v => v.eventCount !== v.eventRefsLength)
    .map(v => ({
      venueId: v.id,
      venueName: v.name,
      recordedEventCount: v.eventCount,
      actualEventRefsLength: v.eventRefsLength,
    }));
}

interface EventCandidate {
  eventId: string;
  eventTitle: string;
  placeId: string;
  linkedVenueId?: string;
}

async function main(): Promise<void> {
  if (!hasFirebaseConfig || !db) {
    console.error('缺少 Firebase 環境變數，請確認 .env 設定');
    process.exit(1);
  }

  console.log('模式：唯讀稽核（不會寫入）\n');

  // 1. approved 活動的 placeId 缺失統計
  const eventsSnapshot = await db
    .collection('coffeeEvents')
    .where('status', '==', 'approved')
    .get();

  let withPlaceId = 0;
  let withoutPlaceId = 0;
  const candidates: EventCandidate[] = [];

  for (const doc of eventsSnapshot.docs) {
    const data = doc.data();
    const placeId: string | undefined = data.location?.placeId;
    if (placeId) {
      withPlaceId++;
      candidates.push({
        eventId: doc.id,
        eventTitle: data.title ?? '(無標題)',
        placeId,
        linkedVenueId: data.location?.venueId,
      });
    } else {
      withoutPlaceId++;
    }
  }

  console.log(`approved 活動總數：${eventsSnapshot.size}`);
  console.log(`  有 location.placeId：${withPlaceId}`);
  console.log(`  沒有 location.placeId（永遠無法連結場地）：${withoutPlaceId}\n`);

  // 2. 讀取所有 venues，建立 placeId 對應表 + eventCount 一致性所需資料
  const venuesSnapshot = await db.collection('venues').get();

  const venueList: { id: string; name: string; placeId?: string }[] = [];
  const venueEventCountList: {
    id: string;
    name: string;
    eventCount: number;
    eventRefsLength: number;
  }[] = [];
  // 同一個 placeId 若被多個 venue 共用，比對時只取第一筆代表；重複本身已在 findDuplicatePlaceIds 另外列出
  const venueByPlaceId = new Map<
    string,
    { id: string; name: string; eventRefs: DocumentReference[] }
  >();

  for (const doc of venuesSnapshot.docs) {
    const data = doc.data();
    const name: string = data.name ?? '(無名稱)';
    const placeId: string | undefined = data.placeId;
    const eventRefs: DocumentReference[] = data.eventRefs ?? [];
    const eventCount: number = data.eventCount ?? 0;

    venueList.push({ id: doc.id, name, placeId });
    venueEventCountList.push({ id: doc.id, name, eventCount, eventRefsLength: eventRefs.length });

    if (placeId && !venueByPlaceId.has(placeId)) {
      venueByPlaceId.set(placeId, { id: doc.id, name, eventRefs });
    }
  }

  console.log(`場地總數：${venuesSnapshot.size}\n`);

  const duplicates = findDuplicatePlaceIds(venueList);
  console.log('=== 重複 placeId ===');
  if (duplicates.length === 0) {
    console.log('（無）\n');
  } else {
    for (const group of duplicates) {
      console.log(`placeId ${group.placeId} 被以下場地共用：`);
      for (const v of group.venues) {
        console.log(`  - ${v.name} (${v.id})`);
      }
    }
    console.log('');
  }

  const mismatches = findEventCountMismatches(venueEventCountList);
  console.log('=== eventCount 不一致 ===');
  if (mismatches.length === 0) {
    console.log('（無）\n');
  } else {
    for (const m of mismatches) {
      console.log(
        `場地「${m.venueName}」(${m.venueId})：記錄 eventCount=${m.recordedEventCount}，實際 eventRefs.length=${m.actualEventRefsLength}`
      );
    }
    console.log('');
  }

  // 3. 重跑既有 backfill 腳本的匹配檢查邏輯（唯讀，直接複用 determineBackfillAction）
  let matched = 0;
  let alreadyLinked = 0;
  let needsRepairEvent = 0;
  let needsLinkBoth = 0;
  let noMatchingVenue = 0;

  // 記錄本次掃描內已「視為連結」的活動，避免同一場地底下多筆待修活動互相干擾判斷
  const linkedEventIdsByPlaceId = new Map<string, Set<string>>();

  console.log('=== 精確匹配檢查（複用 backfill 腳本邏輯） ===');
  for (const candidate of candidates) {
    const venue = venueByPlaceId.get(candidate.placeId);
    if (!venue) {
      noMatchingVenue++;
      continue;
    }
    matched++;

    if (!linkedEventIdsByPlaceId.has(candidate.placeId)) {
      linkedEventIdsByPlaceId.set(candidate.placeId, new Set(venue.eventRefs.map(ref => ref.id)));
    }
    const linkedEventIds = linkedEventIdsByPlaceId.get(candidate.placeId)!;

    const action = determineBackfillAction(
      linkedEventIds.has(candidate.eventId),
      candidate.linkedVenueId,
      venue.id
    );

    if (action === 'skip') {
      alreadyLinked++;
      continue;
    }

    if (action === 'repair-event') {
      needsRepairEvent++;
      console.log(
        `[待修：僅活動端 venueId 缺失] 活動「${candidate.eventTitle}」(${candidate.eventId}) → 場地「${venue.name}」(${venue.id})`
      );
    } else {
      needsLinkBoth++;
      console.log(
        `[待修：雙向都未連結] 活動「${candidate.eventTitle}」(${candidate.eventId}) → 場地「${venue.name}」(${venue.id})`
      );
    }
  }
  if (needsRepairEvent === 0 && needsLinkBoth === 0) {
    console.log('（無）');
  }
  console.log('');

  console.log('=== 統計 ===');
  console.log(`approved 活動總數：${eventsSnapshot.size}`);
  console.log(`  有 placeId：${withPlaceId}`);
  console.log(`  無 placeId：${withoutPlaceId}`);
  console.log(`場地總數：${venuesSnapshot.size}`);
  console.log(`重複 placeId 群組數：${duplicates.length}`);
  console.log(`eventCount 不一致場地數：${mismatches.length}`);
  console.log(`有 placeId 的活動中，精確匹配到場地：${matched}`);
  console.log(`  雙向連結已同步：${alreadyLinked}`);
  console.log(`  僅活動端 venueId 缺失（待修）：${needsRepairEvent}`);
  console.log(`  雙向都未連結（待修）：${needsLinkBoth}`);
  console.log(`  找不到對應場地：${noMatchingVenue}`);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ 錯誤：', err);
      process.exit(1);
    });
}
