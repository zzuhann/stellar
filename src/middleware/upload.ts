import multer from 'multer';
import { Request, RequestHandler } from 'express';

export class UnsupportedImageTypeError extends Error {}

const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new UnsupportedImageTypeError('檔案格式不支援'));
  }
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },
  fileFilter,
});

export const uploadSingle: RequestHandler = (req, res, next) => {
  upload.single('image')(req, res, error => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError || error instanceof UnsupportedImageTypeError) {
      res.status(400).json({
        success: false,
        error:
          error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
            ? '圖片大小不能超過 5MB'
            : error.message,
      });
      return;
    }

    next(error);
  });
};
