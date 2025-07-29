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
app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
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
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
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

export default app;
