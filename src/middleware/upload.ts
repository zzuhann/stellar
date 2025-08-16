import multer from 'multer';

// 檔案篩選器
const fileFilter = (_req: any, file: any, cb: any) => {
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

// 使用類型斷言來避免 multer 和 express 的類型衝突
export const uploadSingle = upload.single('image') as any;
