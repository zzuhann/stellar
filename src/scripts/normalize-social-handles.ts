/**
 * STELLAR - Data cleanup
 * 清理 coffeeEvents / venues 的 socialMedia.instagram / socialMedia.threads（去掉 @ 與空白）
 *
 * 使用方式：
 *   bun src/scripts/normalize-social-handles.ts           # dry-run，只印出變更
 *   bun src/scripts/normalize-social-handles.ts --apply   # 實際寫入
 *
 * 注意：不碰 line / x / artists，也不更新 updatedAt（資料清理非使用者編輯）
 */

import dotenv from 'dotenv';
dotenv.config();

import admin from 'firebase-admin';
import { normalizeSocialHandles } from '../utils/socialHandle';

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

interface Change {
  ref: FirebaseFirestore.DocumentReference;
  updates: Record<string, string>;
}

async function main(): Promise<void> {
  console.log(APPLY ? '模式：APPLY（會寫入）' : '模式：dry-run（不寫入）');
  const changes: Change[] = [];
  let fieldCount = 0;

  for (const name of COLLECTIONS) {
    const snapshot = await db.collection(name).get();
    console.log(`\n[${name}] 掃描 ${snapshot.size} 筆`);

    for (const doc of snapshot.docs) {
      const socialMedia = doc.get('socialMedia') as Record<string, unknown> | undefined;
      const updates: Record<string, string> = {};

      for (const field of FIELDS) {
        const raw = socialMedia?.[field];
        if (typeof raw !== 'string') continue;
        const cleaned = normalizeSocialHandles(raw);
        if (cleaned === raw) continue;
        updates[`socialMedia.${field}`] = cleaned;
        fieldCount++;
        console.log(
          `${name}/${doc.id}  ${field}: ${JSON.stringify(raw)} → ${JSON.stringify(cleaned)}`
        );
      }

      if (Object.keys(updates).length > 0) changes.push({ ref: doc.ref, updates });
    }
  }

  console.log(`\n需變更：${changes.length} 份文件、${fieldCount} 個欄位`);

  if (!APPLY) {
    console.log('dry-run 結束，未寫入。加 --apply 才會實際更新。');
    return;
  }

  for (let i = 0; i < changes.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const { ref, updates } of changes.slice(i, i + BATCH_SIZE)) batch.update(ref, updates);
    await batch.commit();
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
