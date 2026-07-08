const { setGlobalOptions } = require('firebase-functions');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const logger = require('firebase-functions/logger');

// 初始化 Firebase Admin
admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ maxInstances: 10 });

// 每天00:00執行：清理過期的 activeEventIds
exports.cleanupExpiredActiveEventIds = onSchedule(
  {
    schedule: '0 0 * * *', // 每天00:00執行
    timeZone: 'Asia/Taipei',
    region: 'asia-east1',
  },
  async event => {
    const now = admin.firestore.Timestamp.now();

    logger.info('Starting cleanup of expired activeEventIds...');

    // 取得所有有 activeEventIds 的 approved 藝人
    const artistsSnapshot = await db.collection('artists').where('status', '==', 'approved').get();

    logger.info(`Found ${artistsSnapshot.size} approved artists to check`);

    const batch = db.batch();
    let updatedCount = 0;

    for (const artistDoc of artistsSnapshot.docs) {
      const artistData = artistDoc.data();
      const activeEventIds = artistData.activeEventIds || [];

      if (activeEventIds.length === 0) continue;

      logger.info(`Checking ${activeEventIds.length} events for artist ${artistDoc.id}`);

      // 檢查這些事件是否還在進行中
      const validEventIds = [];

      for (const eventId of activeEventIds) {
        const eventDoc = await db.collection('coffeeEvents').doc(eventId).get();

        if (eventDoc.exists) {
          const eventData = eventDoc.data();
          // 檢查事件是否還在進行中（未結束且已審核通過）
          if (
            eventData.status === 'approved' &&
            eventData.datetime &&
            eventData.datetime.end &&
            eventData.datetime.end.toMillis() > now.toMillis()
          ) {
            validEventIds.push(eventId);
          }
        }
        // 如果事件不存在，就不加入 validEventIds（自動清理）
      }

      // 如果 activeEventIds 有變化，就更新
      if (validEventIds.length !== activeEventIds.length) {
        const artistRef = db.collection('artists').doc(artistDoc.id);
        batch.update(artistRef, {
          activeEventIds: validEventIds,
          updatedAt: now,
        });
        updatedCount++;

        logger.info(
          `Artist ${artistDoc.id}: ${activeEventIds.length} -> ${validEventIds.length} active events`
        );
      }
    }

    if (updatedCount > 0) {
      await batch.commit();
      logger.info(`Successfully updated activeEventIds for ${updatedCount} artists`);
    } else {
      logger.info('No artists needed activeEventIds cleanup');
    }

    logger.info('Daily activeEventIds cleanup completed');
  }
);

// GCP Cloud Run 遷移觀察期用：GitHub Actions 的 schedule cron 在高頻率下不可靠
// （官方文件承認高負載會 drop job），改用 Cloud Scheduler 當計時器，
// 職責只有觸發 canary-observation.yml 的 workflow_dispatch，實際檢查邏輯留在該 workflow 裡。
// 觀察期結束（CUTOFF_DATE）後這個 function 可以直接刪除。
const githubCanaryPat = defineSecret('GITHUB_CANARY_PAT');
const CANARY_CUTOFF_DATE = '2026-07-15';
const CANARY_REPO = 'zzuhann/stellar';

exports.triggerCanaryObservation = onSchedule(
  {
    schedule: '*/15 * * * *',
    timeZone: 'Etc/UTC',
    region: 'asia-east1',
    secrets: [githubCanaryPat],
  },
  async () => {
    const today = new Date().toISOString().slice(0, 10);
    if (today >= CANARY_CUTOFF_DATE) {
      logger.info(`觀察期已過 ${CANARY_CUTOFF_DATE}，略過觸發`);
      return;
    }

    const res = await fetch(
      `https://api.github.com/repos/${CANARY_REPO}/actions/workflows/canary-observation.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${githubCanaryPat.value()}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ ref: 'main' }),
      }
    );

    if (!res.ok) {
      logger.error(`觸發 canary-observation workflow 失敗: ${res.status} ${await res.text()}`);
    } else {
      logger.info('已觸發 canary-observation workflow');
    }
  }
);
