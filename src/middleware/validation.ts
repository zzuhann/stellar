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
        Object.assign(req.params, parsedParams);
      }

      if (schema.query) {
        const parsedQuery = schema.query.parse(req.query);
        Object.assign(req.query, parsedQuery);
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
    stageNameZh: z.string().max(100, '中文藝名長度不能超過100個字元').trim().optional(),
    groupNames: z
      .array(z.string().min(1, '團名不能為空').max(50, '團名長度不能超過50個字元').trim())
      .max(5, '最多只能選擇5個團體')
      .optional(),
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
    stageNameZh: z.string().max(100, '中文藝名長度不能超過100個字元').trim().optional(),
    groupNames: z
      .array(z.string().min(1, '團名不能為空').max(50, '團名長度不能超過50個字元').trim())
      .max(5, '最多只能選擇5個團體')
      .optional(),
    realName: z.string().max(100, '本名長度不能超過100個字元').trim().optional(),
    birthday: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, '生日格式錯誤')
      .optional(),
    profileImage: z.string().url('藝人圖片網址格式錯誤').optional(),
  }),
};

// Venue 相關的 schema

const venueRegionEnum = z.preprocess(
  val => (typeof val === 'string' ? val.replace(/臺/g, '台') : val),
  z.enum([
    '台北',
    '新北',
    '桃園',
    '台中',
    '台南',
    '高雄',
    '基隆',
    '新竹',
    '嘉義',
    '宜蘭',
    '苗栗',
    '彰化',
    '南投',
    '雲林',
    '屏東',
    '花蓮',
    '台東',
    '澎湖',
    '金門',
    '連江',
  ])
);

export const venueSchemas = {
  batchReview: z.object({
    updates: z
      .array(
        z.object({
          venueId: z.string().min(1, 'venueId 不能為空'),
          status: z.enum(['active', 'rejected']),
        })
      )
      .min(1, 'updates 不能為空')
      .max(50, '一次最多更新 50 筆'),
  }),
  batchStatus: z.object({
    updates: z
      .array(
        z.object({
          venueId: z.string().min(1, 'venueId 不能為空'),
          status: z.enum(['active', 'inactive']),
        })
      )
      .min(1, 'updates 不能為空')
      .max(50, '一次最多更新 50 筆'),
  }),
  create: z.object({
    name: z.string().min(1, '場地名稱不能為空').max(200).trim(),
    address: z.string().min(1, '地址不能為空').max(500).trim(),
    region: venueRegionEnum,
    lat: z.number().optional(),
    lng: z.number().optional(),
    placeId: z.string().max(500).trim().optional(),
    nearestMrt: z.string().max(100).trim().optional(),
    mrtWalkMinutes: z.number().int().min(0).nullable().optional(),
    capacityRange: z.enum(['20以下', '20-40', '40-60', '60以上']).nullable().optional(),
    description: z.string().max(3000).trim().optional(),
    hostTags: z.array(z.string().min(1).max(50)).optional(),
    preferredContact: z.enum(['instagram', 'threads', 'line', 'form', 'other']).optional(),
    contactUrl: z.string().url('聯絡網址格式不正確').max(500).optional(),
    coverPhoto: z.string().url('封面照片網址格式不正確').optional(),
    otherPhotos: z.array(z.string().url('照片網址格式不正確')).optional(),
    socialMedia: z
      .object({
        threads: z.string().max(500).trim().optional(),
        instagram: z.string().max(500).trim().optional(),
        line: z.string().max(500).trim().optional(),
      })
      .optional(),
  }),
  update: z.object({
    name: z.string().min(1, '場地名稱不能為空').max(200).trim().optional(),
    address: z.string().min(1, '地址不能為空').max(500).trim().optional(),
    region: venueRegionEnum.optional(),
    nearestMrt: z.string().max(100).trim().optional(),
    mrtWalkMinutes: z.number().int().min(0).nullable().optional(),
    capacityRange: z.enum(['20以下', '20-40', '40-60', '60以上']).nullable().optional(),
    description: z.string().max(3000).trim().optional(),
    hostTags: z.array(z.string().min(1).max(50)).optional(),
    preferredContact: z.enum(['instagram', 'threads', 'line', 'form', 'other']).optional(),
    contactUrl: z.string().url('聯絡網址格式不正確').max(500).optional(),
    coverPhoto: z.string().url('封面照片網址格式不正確').optional(),
    otherPhotos: z.array(z.string().url('照片網址格式不正確')).optional(),
    status: z.enum(['active', 'inactive']).optional(),
    socialMedia: z
      .object({
        threads: z.string().max(500).trim().optional(),
        instagram: z.string().max(500).trim().optional(),
        line: z.string().max(500).trim().optional(),
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
      city: z.string().max(50, '城市名稱不能超過 50 個字').trim().optional(),
      coordinates: z.object({
        lat: z.number(),
        lng: z.number(),
      }),
      placeId: z.string().optional(),
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
      .max(10, '最多只能上傳10張詳細圖片')
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
        city: z.string().max(50, '城市名稱不能超過50個字元').trim().optional(),
        coordinates: z.object({
          lat: z.number(),
          lng: z.number(),
        }),
        placeId: z.string().optional(),
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
      .max(10, '最多只能上傳10張詳細圖片')
      .optional(),
  }),
};

// Admin 相關的 schema
export const adminSchemas = {
  listQuery: z.object({
    search: z.string().optional(),
    slug: z.string().optional(),
    id: z.string().optional(),
    status: z.enum(['pending', 'approved', 'rejected']).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  }),
};
