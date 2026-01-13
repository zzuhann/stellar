const { setGlobalOptions } = require('firebase-functions');
const { onSchedule } = require('firebase-functions/v2/scheduler');
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
