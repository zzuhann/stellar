import express from 'express';
import {
  subscribeNotification,
  sendApprovalNotification,
  unsubscribeNotification,
  getVapidKey,
} from '../controllers/notificationController';

const router = express.Router();

router.post('/subscribe', (req, res) => {
  subscribeNotification(req, res).catch(next => next);
});
router.post('/send-approval', (req, res) => {
  sendApprovalNotification(req, res).catch(next => next);
});
router.delete('/unsubscribe/:userId', (req, res) => {
  unsubscribeNotification(req, res).catch(next => next);
});
router.get('/vapid-key', getVapidKey);

export default router;
