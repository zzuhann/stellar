/**
 * STELLAR - Data cleanup
 * 清理 coffeeEvents / venues 的 socialMedia.instagram / socialMedia.threads（去掉 @ 與空白）
 *
 * 使用方式：
 *   npx tsx src/scripts/normalize-social-handles.ts           # dry-run，只印出變更
 *   npx tsx src/scripts/normalize-social-handles.ts --apply   # 實際寫入
 *   --tsv <path>  另外輸出 change/manual 對照表
 *
 * 注意：不碰 line / x / artists，也不更新 updatedAt（資料清理非使用者編輯）
 */

import dotenv from 'dotenv';
dotenv.config();

import admin from 'firebase-admin';
import fs from 'fs';
import { parseSocialHandles } from '../utils/socialHandle';

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
const APPLY = process.argv.includes('--apply');
const COLLECTIONS = ['coffeeEvents', 'venues'];
const FIELDS = ['instagram', 'threads'] as const;
const BATCH_SIZE = 500;
const tsvIndex = process.argv.indexOf('--tsv');
const TSV_PATH = tsvIndex >= 0 ? process.argv[tsvIndex + 1] : undefined;
const tsvRows: string[][] = [];
const cell = (v: string | undefined): string => (v ?? '').replace(/[\t\r\n]+/g, ' ');

interface Change {
  ref: FirebaseFirestore.DocumentReference;
  updateTime: FirebaseFirestore.Timestamp;
  updates: Record<string, string>;
}

async function main(): Promise<void> {
  console.log(APPLY ? '模式：APPLY（會寫入）' : '模式：dry-run（不寫入）');
  const changes: Change[] = [];
  let fieldCount = 0;
  const manual: string[] = [];

  for (const name of COLLECTIONS) {
    const snapshot = await db.collection(name).get();
    console.log(`\n[${name}] 掃描 ${snapshot.size} 筆`);

    for (const doc of snapshot.docs) {
      const socialMedia = doc.get('socialMedia') as Record<string, unknown> | undefined;
      const updates: Record<string, string> = {};

      for (const field of FIELDS) {
        const raw = socialMedia?.[field];
        if (typeof raw !== 'string') continue;
        const cleaned = parseSocialHandles(raw);
        const meta = [
          name,
          doc.id,
          doc.get('slug'),
          doc.get(name === 'venues' ? 'name' : 'title'),
          doc.get('status'),
          field,
          raw,
        ];
        if (cleaned === null) {
          tsvRows.push(['manual', ...meta, ''].map(cell));
          manual.push(`${name}/${doc.id}  ${field}: ${JSON.stringify(raw)}`);
          continue;
        }
        if (cleaned === raw) continue;
        tsvRows.push(['change', ...meta, cleaned].map(cell));
        updates[`socialMedia.${field}`] = cleaned;
        fieldCount++;
        console.log(
          `${name}/${doc.id}  ${field}: ${JSON.stringify(raw)} → ${JSON.stringify(cleaned)}`
        );
      }

      if (Object.keys(updates).length > 0)
        changes.push({ ref: doc.ref, updateTime: doc.updateTime, updates });
    }
  }

  console.log(`\n=== 需人工處理（${manual.length} 筆，不會被寫入）===`);
  manual.forEach(line => console.log(line));

  console.log(`\n需變更：${changes.length} 份文件、${fieldCount} 個欄位`);

  if (TSV_PATH) {
    const header = ['kind', 'collection', 'id', 'slug', 'name', 'status', 'field', 'old', 'new'];
    fs.writeFileSync(TSV_PATH, [header, ...tsvRows].map(r => r.join('\t')).join('\n') + '\n');
    console.log(`TSV 已輸出：${TSV_PATH}（${tsvRows.length} 列）`);
  }

  if (!APPLY) {
    console.log('dry-run 結束，未寫入。加 --apply 才會實際更新。');
    return;
  }

  for (let i = 0; i < changes.length; i += BATCH_SIZE) {
    const batch = db.batch();
    // Precondition: fail the whole batch if a doc was edited after we scanned it, instead of overwriting with stale data
    for (const { ref, updateTime, updates } of changes.slice(i, i + BATCH_SIZE))
      batch.update(ref, updates, { lastUpdateTime: updateTime });
    try {
      await batch.commit();
    } catch (err) {
      console.error(
        '寫入失敗（可能有文件在掃描後被編輯），此批未寫入。請重跑 dry-run 確認後再 apply。'
      );
      throw err;
    }
    console.log(`已寫入 ${Math.min(i + BATCH_SIZE, changes.length)} / ${changes.length}`);
  }
  console.log('完成。注意：後端記憶體快取不會被腳本清除，需等 TTL 過期或呼叫 /cache 管理端點。');
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ 錯誤：', err);
    process.exit(1);
  });
