import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import routes from './routes';

dotenv.config();

const app = express();

// 安全中介軟體
app.use(helmet());

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
      // 允許沒有 origin 的請求（例如同源請求）
      if (!origin) {
        return callback(null, true);
      }

      // 檢查是否在允許的清單中
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // 開發環境允許所有來源
      if (process.env.NODE_ENV === 'development') {
        return callback(null, true);
      }

      // 生產環境拒絕未授權的來源
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
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
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
