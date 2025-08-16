import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import routes from './routes';

dotenv.config();

const app = express();

// 強制 HTTPS (生產環境)
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(301, `https://${req.header('host')}${req.url}`);
    } else {
      next();
    }
  });
}

// 安全中介軟體
app.use(
  helmet({
    // 允許跨域請求資源（為了支援圖片上傳和顯示）
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分鐘
  max: 100, // 每個 IP 最多 100 次請求
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// 登入相關的嚴格限制
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分鐘
  max: 5, // 每個 IP 最多 5 次登入嘗試
  message: { error: 'Too many authentication attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // 成功的請求不計入限制
});

// Places API 的寬鬆限制（因為地址搜尋會頻繁呼叫）
const placesLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分鐘
  max: 200, // 每個 IP 最多 200 次請求
  message: { error: 'Too many places requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);
app.use('/api/auth', authLimiter);
app.use('/api/places', placesLimiter);

// CORS 設定
const allowedOrigins = [
  // 本地開發
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  // 生產環境 - 從環境變數讀取
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
  ...(process.env.ADDITIONAL_CORS_ORIGINS ? process.env.ADDITIONAL_CORS_ORIGINS.split(',') : []),
];

app.use(
  cors({
    origin: (origin, callback) => {
      console.error(`CORS request from origin: ${origin}, allowed origins:`, allowedOrigins);
      // 允許沒有 origin 的請求（例如同源請求）
      if (!origin) {
        console.error('No origin, allowing request');
        return callback(null, true);
      }

      // 檢查是否在允許的清單中
      if (allowedOrigins.includes(origin)) {
        console.error('Origin allowed');
        return callback(null, true);
      }

      // 開發環境允許所有來源
      if (process.env.NODE_ENV === 'development') {
        console.error('Development mode, allowing all origins');
        return callback(null, true);
      }

      // 生產環境拒絕未授權的來源
      console.error('Origin not allowed, rejecting');
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })
);

// 日誌中介軟體
app.use(morgan('combined'));

// 解析中介軟體
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// API 路由
app.use('/api', routes);

// 全域錯誤處理
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // 詳細的錯誤日誌記錄，幫助識別真正的問題
  console.error('=== Unhandled Error ===', {
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path,
    origin: req.headers.origin,
    userAgent: req.headers['user-agent'],
    errorName: err.name,
    errorMessage: err.message,
    errorStack: err.stack,
    // 特別記錄可能導致假 CORS 錯誤的情況
    isPotentialTimeoutError: err.message.includes('timeout') || err.message.includes('ECONNRESET'),
    isFirestoreError: err.message.includes('Firestore') || err.message.includes('GRPC'),
    isR2Error: err.message.includes('S3') || err.message.includes('AWS'),
  });

  // 確保 CORS headers 被設置，避免錯誤被誤判為 CORS 問題
  const origin = req.headers.origin;
  if (origin && (allowedOrigins.includes(origin) || process.env.NODE_ENV === 'development')) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  }

  // 生產環境不洩露敏感資訊
  const isProduction = process.env.NODE_ENV === 'production';

  res.status(500).json({
    error: 'Internal server error',
    message: isProduction ? 'Something went wrong' : err.message,
    ...(isProduction ? {} : { stack: err.stack }), // 開發環境才顯示 stack trace
  });
});

// 404 處理
app.use('*', (_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// 傳統模式導出（開發用）
export default app;

// Serverless 模式導出（Zeabur 部署用）
export const handler = app;
