import multer, { FileFilterCallback } from 'multer';
import { Request } from 'express';

// 檔案篩選器
const fileFilter = (req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
  const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('檔案格式不支援'));
  }
};

// Multer 設定
const upload = multer({
  storage: multer.memoryStorage(), // 使用記憶體儲存，因為要上傳到 R2
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB 限制
    files: 1, // 一次只能上傳一個檔案
  },
  fileFilter,
});

export const uploadSingle = upload.single('image');
