import app from './app';

const PORT = process.env.PORT || 3001;

app.listen(PORT, (error?: Error) => {
  if (error) throw error;
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 CORS enabled for: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
});
