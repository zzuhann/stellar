import { NextFunction, Request, Response } from 'express';
import { sendContactNotification } from '../services/emailService';

export const submitContact = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const { name, email, message } = req.body as { name: string; email: string; message: string };

  try {
    await sendContactNotification({ name, email, message });
    res.json({ success: true });
  } catch (err) {
    console.error('[contact] failed to handle contact submission:', err);
    next(new AppError(500, 'CONTACT_SUBMISSION_FAILED', 'Contact submission failed'));
  }
};
import { AppError } from '../utils/AppError';
