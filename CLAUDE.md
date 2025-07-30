# 創建專案記錄文件
  cat > CLAUDE.md << 'EOF'
  # 台灣生咖地圖後端專案

  ## 專案概述
  - K-pop 藝人生日應援咖啡活動平台後端
  - 技術棧：Node.js + Express + TypeScript +
   Firebase
  - 使用 Bun runtime 提升開發效率

  ## 完成功能
  - ✅ 後端 API 架構（藝人、活動管理）
  - ✅ Firebase Firestore 資料庫整合
  - ✅ 用戶認證與角色權限
  - ✅ 完整測試套件（31 個測試）
  - ✅ ESLint + Prettier + Pre-commit hooks

  ## 下一步
  - 建立前端專案架構
  - 實作地圖展示功能（Leaflet）
  - 實作投稿與審核系統

  ## 重要設定
  - Firebase 需要建立複合索引
  - Bun 安裝路徑：~/.bun/bin/bun
  EOF

  Update Todos
  ⎿ ☒ 討論 Zustand 狀態管理設計模式         
    ☒ 設計資料庫 Schema（藝人、生咖活動）
    ☒ 建立後端專案架構與 API 設計
    ☒ 建立和測試後端 API
    ☒ 編寫後端單元測試
    ☒ 設置 ESLint 配置與規範
    ☒ 配置 pre-commit hooks（TypeScript + 
      ESLint）
    ☐ 建立前端專案架構
    ☐ 實作地圖展示功能（Leaflet）
    ☐ 實作投稿與審核系統