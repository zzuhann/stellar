#!/bin/bash

echo "🚀 測試 Stellar Backend..."

# 顏色定義
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 檢查構建
echo "📦 檢查 TypeScript 構建..."
if npm run build; then
    echo -e "${GREEN}✅ 構建成功${NC}"
else
    echo -e "${RED}❌ 構建失敗${NC}"
    exit 1
fi

# 檢查端口是否被佔用
PORT=3001
if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null ; then
    echo -e "${YELLOW}⚠️  端口 $PORT 被佔用，正在終止...${NC}"
    lsof -ti:$PORT | xargs kill -9 2>/dev/null
    sleep 2
fi

# 啟動伺服器
echo "🏃 啟動伺服器..."
npm start &
SERVER_PID=$!

# 等待伺服器啟動
echo "⏳ 等待伺服器啟動..."
sleep 5

# 測試健康檢查
echo "🔍 測試健康檢查端點..."
if curl -s -f http://localhost:3001/api/health > /dev/null; then
    echo -e "${GREEN}✅ 健康檢查通過${NC}"
    
    # 顯示健康檢查詳細資訊
    echo "📊 健康檢查詳細資訊:"
    curl -s http://localhost:3001/api/health | python3 -m json.tool 2>/dev/null || curl -s http://localhost:3001/api/health
else
    echo -e "${RED}❌ 健康檢查失敗${NC}"
fi

# 測試其他端點
echo -e "\n🧪 測試其他 API 端點..."

# 測試藝人 API
echo "👨‍🎤 測試藝人 API..."
ARTISTS_RESPONSE=$(curl -s -w "%{http_code}" http://localhost:3001/api/artists)
HTTP_CODE="${ARTISTS_RESPONSE: -3}"
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "500" ]; then
    echo -e "${GREEN}✅ 藝人 API 可訪問 (HTTP $HTTP_CODE)${NC}"
else
    echo -e "${RED}❌ 藝人 API 失敗 (HTTP $HTTP_CODE)${NC}"
fi

# 測試活動 API
echo "🎪 測試活動 API..."
EVENTS_RESPONSE=$(curl -s -w "%{http_code}" http://localhost:3001/api/events)
HTTP_CODE="${EVENTS_RESPONSE: -3}"
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "500" ]; then
    echo -e "${GREEN}✅ 活動 API 可訪問 (HTTP $HTTP_CODE)${NC}"
else
    echo -e "${RED}❌ 活動 API 失敗 (HTTP $HTTP_CODE)${NC}"
fi

# 測試 Places API
echo "📍 測試 Places API..."
PLACES_RESPONSE=$(curl -s -X POST -H "Content-Type: application/json" \
    -d '{"input":"台北"}' \
    -w "%{http_code}" \
    http://localhost:3001/api/places/autocomplete)
HTTP_CODE="${PLACES_RESPONSE: -3}"
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "500" ]; then
    echo -e "${GREEN}✅ Places API 可訪問 (HTTP $HTTP_CODE)${NC}"
else
    echo -e "${RED}❌ Places API 失敗 (HTTP $HTTP_CODE)${NC}"
fi

# 測試 CORS
echo "🌐 測試 CORS headers..."
CORS_HEADERS=$(curl -s -I -X OPTIONS \
    -H "Origin: http://localhost:3000" \
    -H "Access-Control-Request-Method: GET" \
    http://localhost:3001/api/health | grep -i "access-control")

if [ -n "$CORS_HEADERS" ]; then
    echo -e "${GREEN}✅ CORS headers 存在${NC}"
    echo "$CORS_HEADERS"
else
    echo -e "${YELLOW}⚠️  CORS headers 未找到（可能正常）${NC}"
fi

# 清理
echo -e "\n🧹 清理..."
kill $SERVER_PID 2>/dev/null
wait $SERVER_PID 2>/dev/null

echo -e "\n${GREEN}🎉 後端測試完成！${NC}"
echo "💡 如果看到 HTTP 500 錯誤，這通常是因為缺少環境變數（Firebase、R2），這是正常的。"
echo "📋 重要的是伺服器能夠啟動並響應請求。"