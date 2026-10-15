/**
 * STELLAR - 匯入場地標籤回填表
 *
 * 背景：場地標籤由 STELLAR 依店家說明代貼，第 1 階段以 Google Sheet 回填表為準。
 * 規格：specs/features/venue-tags/design-backend.md §6
 *
 * 使用方式：
 *   1. Google Sheet 主表「Untitled」→ 檔案 → 下載 → CSV（CSV 不要放進 repo，裡面有備註與店家資料）
 *   2. 先 dry-run，看每家的差異：
 *        npx tsx src/scripts/import-venue-tags.ts --csv <路徑>
 *   3. 確認無誤後才寫入：
 *        npx tsx src/scripts/import-venue-tags.ts --csv <路徑> --commit
 *
 * 注意：
 *   - 只處理「整理狀態」為「已確認」的列；有任何一格不合法就整批不寫
 *   - 已確認的場地整個覆蓋 tags 與表上有的附加欄位；在後台改過的標籤會被蓋掉
 *   - 腳本直接寫 Firestore，不會清任何 instance 的記憶體快取
 */

import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import csv from 'csv-parser';
import { FieldValue } from 'firebase-admin/firestore';
import { db, hasFirebaseConfig } from '../config/firebase';
import { buildImportPlan, ExistingVenueTagFields } from '../services/venueTagImport';

const readCsvRows = (filePath: string): Promise<string[][]> =>
  new Promise((resolve, reject) => {
    const rows: string[][] = [];
    fs.createReadStream(filePath)
      .on('error', reject) // pipe() does not forward source errors (e.g. wrong path)
      // headers: false keeps duplicate header names visible (row objects would merge them)
      .pipe(csv({ headers: false }))
      .on('data', (row: Record<string, string>) => rows.push(Object.values(row)))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });

export async function run({ csvPath, commit }: { csvPath: string; commit: boolean }) {
  if (!hasFirebaseConfig || !db) {
    console.error('缺少 Firebase 環境變數，請確認 .env 設定');
    return 1;
  }
  console.log(`模式：${commit ? '⚠️  COMMIT（會寫入）' : 'DRY RUN（不會寫入）'}\n`);

  const rows = await readCsvRows(csvPath);
  const snapshot = await db
    .collection('venues')
    .select('name', 'tags', 'sourceLinks', 'equipmentNote', 'infoUpdatedOn', 'calendarUrl')
    .get();
  const existing = new Map<string, ExistingVenueTagFields>(
    snapshot.docs.map(doc => [doc.id, doc.data() as ExistingVenueTagFields])
  );

  const plan = buildImportPlan(rows, existing);
  plan.warnings.forEach(w => console.log(w));

  if (plan.errors.length > 0) {
    console.error(`\n❌ 有 ${plan.errors.length} 個錯誤，整批不寫入：`);
    plan.errors.forEach(e => console.error(`  ${e}`));
    return 1;
  }

  for (const change of plan.changes) {
    console.log(`\n${change.name}（${change.venueId}，第 ${change.rowNumber} 列）`);
    change.lines.forEach(line => console.log(`  ${line}`));
  }
  const { confirmed, changed, unchanged, skipped } = plan.stats;
  console.log(
    `\n=== 統計 ===\n已確認 ${confirmed} 列、有變動 ${changed} 家、沒有變動 ${unchanged} 家、略過（非已確認）${skipped} 列`
  );

  if (!commit) {
    if (changed > 0) console.log('\n這是 dry-run，尚未寫入。確認差異無誤後加上 --commit 執行。');
    return 0;
  }
  if (changed === 0) return 0;

  // ponytail: one batch keeps the import all-or-nothing; Firestore caps a batch at 500 writes
  const batch = db.batch();
  for (const change of plan.changes) {
    batch.update(db.collection('venues').doc(change.venueId), {
      ...change.update,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  try {
    await batch.commit();
  } catch (error) {
    console.error('\n❌ 寫入失敗，Firestore batch 沒有套用：', error);
    return 1;
  }

  console.log(`\n✅ 寫入完成：${changed} 家`);
  console.log('接下來要手動清快取，前台才會看到新資料：');
  console.log('  1. DELETE https://api.stellar-zone.com/api/cache/clear（admin token）');
  console.log('  2. 觸發前端 POST /api/revalidate');
  return 0;
}

if (require.main === module) {
  const csvIndex = process.argv.indexOf('--csv');
  const csvPath = csvIndex >= 0 ? process.argv[csvIndex + 1] : undefined;
  if (!csvPath) {
    console.error('用法：npx tsx src/scripts/import-venue-tags.ts --csv <路徑> [--commit]');
    process.exit(1);
  }
  run({ csvPath, commit: process.argv.includes('--commit') })
    .then(code => process.exit(code))
    .catch(err => {
      console.error('❌ 錯誤：', err);
      process.exit(1);
    });
}
