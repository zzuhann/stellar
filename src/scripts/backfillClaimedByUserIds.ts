import dotenv from 'dotenv';
dotenv.config();

import { db, hasFirebaseConfig } from '../config/firebase';

async function backfillClaimedByUserIds(): Promise<void> {
  if (!hasFirebaseConfig || !db) {
    console.error('Firebase not configured. Check environment variables.');
    process.exit(1);
  }

  const snapshot = await db.collection('coffeeEvents').get();

  let updated = 0;
  let skipped = 0;
  const batch = db.batch();
  let batchCount = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const verifiedOrganizers: Array<{ userId: string }> = data.verifiedOrganizers || [];

    if (verifiedOrganizers.length === 0) {
      skipped++;
      continue;
    }

    const claimedByUserIds = [...new Set(verifiedOrganizers.map(o => o.userId))];

    // 若已有正確的值則跳過
    const existing: string[] = data.claimedByUserIds || [];
    const alreadySynced =
      claimedByUserIds.length === existing.length &&
      claimedByUserIds.every(id => existing.includes(id));

    if (alreadySynced) {
      skipped++;
      continue;
    }

    batch.update(doc.ref, { claimedByUserIds });
    updated++;
    batchCount++;

    // Firestore batch 上限 500
    if (batchCount === 500) {
      await batch.commit();
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  console.log(`Done. updated=${updated}, skipped=${skipped}`);
}

backfillClaimedByUserIds().catch(err => {
  console.error(err);
  process.exit(1);
});
