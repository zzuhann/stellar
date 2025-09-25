import express from 'express'
import {
  subscribeNotification,
  sendApprovalNotification,
  unsubscribeNotification,
  getVapidKey
} from '../controllers/notificationController'

const router = express.Router()

router.post('/subscribe', subscribeNotification)
router.post('/send-approval', sendApprovalNotification)
router.delete('/unsubscribe/:userId', unsubscribeNotification)
router.get('/vapid-key', getVapidKey)

export default router