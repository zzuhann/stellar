import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema, ZodError } from 'zod';

// 錯誤碼定義
export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  REQUIRED_FIELD: 'REQUIRED_FIELD',
  INVALID_FORMAT: 'INVALID_FORMAT',
  INVALID_LENGTH: 'INVALID_LENGTH',
  INVALID_URL: 'INVALID_URL',
  INVALID_ENUM: 'INVALID_ENUM',
  INVALID_DATE: 'INVALID_DATE',
  TOO_MANY_ITEMS: 'TOO_MANY_ITEMS',
  TOO_FEW_ITEMS: 'TOO_FEW_ITEMS',
} as const;

type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// 通用驗證中間件
export const validateRequest = (schema: {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // 依序驗證，遇到錯誤立即停止
      if (schema.params) {
        const parsedParams = schema.params.parse(req.params);
        req.params = parsedParams as typeof req.params;
      }

      if (schema.query) {
        const parsedQuery = schema.query.parse(req.query);
        req.query = parsedQuery as typeof req.query;
      }

      if (schema.body) {
        req.body = schema.body.parse(req.body);
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        // 只取第一個錯誤
        const firstError = error.issues[0];

        // 將 Zod 錯誤碼轉換為我們的錯誤碼
        let errorCode: ErrorCode = ERROR_CODES.VALIDATION_FAILED;

        switch (firstError.code) {
          case 'invalid_type':
            if (
              firstError.message.includes('received undefined') ||
              firstError.message.includes('received null')
            ) {
              errorCode = ERROR_CODES.REQUIRED_FIELD;
            }
            break;
          case 'too_small':
            errorCode =
              firstError.minimum === 1 ? ERROR_CODES.REQUIRED_FIELD : ERROR_CODES.INVALID_LENGTH;
            break;
          case 'too_big':
            errorCode = ERROR_CODES.INVALID_LENGTH;
            break;
          case 'invalid_format':
            if ('format' in firstError && firstError.format === 'url') {
              errorCode = ERROR_CODES.INVALID_URL;
            } else if ('format' in firstError && firstError.format === 'datetime') {
              errorCode = ERROR_CODES.INVALID_DATE;
            } else {
              errorCode = ERROR_CODES.INVALID_FORMAT;
            }
            break;
          case 'invalid_value':
            errorCode = ERROR_CODES.INVALID_ENUM;
            break;
        }

        return res.status(400).json({
          error: firstError.message,
          code: errorCode,
          field: firstError.path.join('.'),
        });
      }

      return res.status(500).json({
        error: 'Server Internal Error',
        code: 'INTERNAL_ERROR',
      });
    }
  };
};

// Artist 相關的 schema
export const artistSchemas = {
  create: z.object({
    stageName: z.string().min(1, '藝名為必填欄位').max(100, '藝名長度不能超過100個字元').trim(),
    realName: z.string().max(100, '本名長度不能超過100個字元').trim().optional(),
    birthday: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, '生日格式錯誤')
      .optional(),
    profileImage: z.string().url('請輸入正確的圖片連結格式').optional(),
  }),

  update: z.object({
    stageName: z
      .string()
      .min(1, '藝名為必填欄位')
      .max(100, '藝名長度不能超過100個字元')
      .trim()
      .optional(),
    realName: z.string().max(100, '本名長度不能超過100個字元').trim().optional(),
    birthday: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, '生日格式錯誤')
      .optional(),
    profileImage: z.string().url('偶像圖片網址格式錯誤').optional(),
  }),

  review: z.object({
    status: z.enum(['approved', 'rejected', 'exists'], {
      message: '狀態必須是 approved、rejected 或 exists 其中之一',
    }),
    reason: z.string().max(500, '原因說明不能超過500個字元').trim().optional(),
  }),

  reject: z.object({
    reason: z.string().max(500, '原因說明不能超過500個字元').trim().optional(),
  }),

  params: z.object({
    id: z.string().min(1, 'ID 為必填參數').max(50, 'ID 長度不正確'),
  }),

  query: z.object({
    status: z
      .enum(['approved', 'pending', 'rejected'], {
        message: '狀態篩選值不正確',
      })
      .optional(),
    createdBy: z.string().max(50, '創建者ID長度不正確').optional(),
    birthdayStartDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, '開始日期格式錯誤')
      .optional(),
    birthdayEndDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, '結束日期格式錯誤')
      .optional(),
    search: z.string().max(100, '搜尋關鍵字過長').optional(),
    includeStats: z.string().optional(),
    sortBy: z
      .enum(['stageName', 'coffeeEventCount', 'createdAt'], {
        message: '排序欄位不正確',
      })
      .optional(),
    sortOrder: z
      .enum(['asc', 'desc'], {
        message: '排序方向必須是 asc 或 desc',
      })
      .optional(),
  }),
};

// Event 相關的 schema
export const eventSchemas = {
  create: z.object({
    title: z.string().min(1, '標題為必填欄位').max(200, '標題不能超過200個字').trim(),
    description: z.string().max(2000, '描述不能超過 2000 個字').trim().optional(),
    location: z.object({
      name: z.string().min(1, '地點名稱為必填').max(200, '地點名稱不能超過 200 個字').trim(),
      address: z.string().max(500, '地點地址不能超過 500 個字').trim().optional(),
    }),
    datetime: z.object({
      start: z.object({
        _seconds: z.number(),
        _nanoseconds: z.number(),
      }),
      end: z.object({
        _seconds: z.number(),
        _nanoseconds: z.number(),
      }),
    }),
    artistIds: z
      .array(z.string().min(1, '藝人ID不能為空'))
      .min(1, '至少需要選擇一位藝人')
      .max(10, '最多只能選擇 10 位藝人'),
    socialMedia: z
      .object({
        instagram: z.string().optional(),
        x: z.string().optional(),
        threads: z.string().optional(),
      })
      .refine(data => data.instagram || data.x || data.threads, {
        message: '至少需要填寫一個社群媒體帳號（Instagram、X 或 Threads）',
        path: ['socialMedia'],
      }),
    mainImage: z.string().url('主圖片網址格式不正確').optional(),
    detailImage: z
      .array(z.string().url('詳細圖片網址格式不正確'))
      .max(5, '最多只能上傳5張詳細圖片')
      .optional(),
  }),

  update: z.object({
    title: z
      .string()
      .min(1, '活動標題為必填欄位')
      .max(200, '活動標題不能超過200個字元')
      .trim()
      .optional(),
    description: z.string().max(2000, '活動描述不能超過2000個字元').trim().optional(),
    location: z
      .object({
        name: z.string().min(1, '地點名稱為必填欄位').max(200, '地點名稱不能超過200個字元').trim(),
        address: z.string().max(500, '地點地址不能超過500個字元').trim().optional(),
      })
      .optional(),
    datetime: z
      .object({
        start: z.object({
          _seconds: z.number(),
          _nanoseconds: z.number(),
        }),
        end: z.object({
          _seconds: z.number(),
          _nanoseconds: z.number(),
        }),
      })
      .optional(),
    artistIds: z
      .array(z.string().min(1, '藝人ID不能為空'))
      .min(1, '至少需要選擇一位藝人')
      .max(10, '最多只能選擇10位藝人')
      .optional(),
    socialMedia: z
      .object({
        instagram: z.string().optional(),
        x: z.string().optional(),
        threads: z.string().optional(),
      })
      .refine(data => data.instagram || data.x || data.threads, {
        message: '至少需要填寫一個社群媒體帳號（Instagram、X 或 Threads）',
        path: ['socialMedia'],
      })
      .optional(),
    mainImage: z.string().url('主圖片網址格式不正確').optional(),
    detailImage: z
      .array(z.string().url('詳細圖片網址格式不正確'))
      .max(5, '最多只能上傳5張詳細圖片')
      .optional(),
  }),

  review: z.object({
    status: z.enum(['approved', 'rejected'], {
      message: '狀態必須是 approved 或 rejected 其中之一',
    }),
    reason: z.string().max(500, '原因說明不能超過500個字元').trim().optional(),
  }),

  reject: z.object({
    reason: z.string().max(500, '原因說明不能超過500個字元').trim().optional(),
  }),

  params: z.object({
    id: z.string().min(1, 'ID 為必填參數').max(50, 'ID 長度不正確'),
  }),
};
