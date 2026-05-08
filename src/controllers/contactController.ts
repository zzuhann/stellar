import { Request, Response } from 'express';
import { sendContactNotification } from '../services/emailService';

export const submitContact = async (req: Request, res: Response): Promise<void> => {
  const { name, email, message } = req.body as { name: string; email: string; message: string };

  try {
    await sendContactNotification({ name, email, message });
    res.json({ success: true });
  } catch (err) {
    console.error('[contact] failed to handle contact submission:', err);
    res.status(500).json({ success: false, error: '伺服器錯誤，請稍後再試' });
  }
};
