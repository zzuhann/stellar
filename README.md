# Stellar ⭐

A comprehensive backend API for managing K-pop artists and coffee shop support events, built with Express.js, TypeScript, and Firebase.

## Project Overview

Stellar is a backend service that powers a platform where fans can create, manage, and discover coffee shop support events for K-pop artists. The system handles artist profiles, event management, user authentication, image uploads, and real-time notifications with robust admin approval workflows.

**Key Use Cases:**
- Submit and manage K-pop artist profiles with detailed information
- Create and discover coffee shop support events with location mapping
- Admin moderation system for content approval
- Real-time notifications for status updates
- Advanced filtering and search capabilities

## Tech Stack

**Backend Framework:**
- Express, Node.js with Bun runtime, TypeScript

**Database & Authentication:**
- Firebase Firestore (NoSQL document database)
- Firebase Admin SDK for authentication and user management

**File Storage & APIs:**
- Cloudflare R2 (S3-compatible) for image storage
- Google Maps API for location services
- Sharp for image processing and optimization

**Deployment & Infrastructure:**
- Docker containerization with multi-stage builds
- GCP Cloud Run (deployed via Cloud Build, see `cloudbuild.yaml`)
- Built-in health checks and monitoring

**Development Tools:**
- ESLint + Prettier for code quality
- Morgan for request logging
- Express rate limiting and security middleware

## Architecture

### Data Flow

**Design Decisions:**
- **Service Layer Pattern**: Separates business logic from controllers for better testability
- **Firebase Integration**: Chosen for real-time capabilities and managed authentication
- **Cloudflare R2**: Cost-effective S3-compatible storage for images
- **Memory Caching**: Reduces Firestore reads for frequently accessed data
- **Type Safety**: Comprehensive TypeScript interfaces for all data models

## 🚀 開發指南

### 環境需求

- **Node.js 20+** 或 **Node.js 24**（推薦，與生產環境一致）
- **Bun**（開發時使用，提供更快的 hot reload）
- npm 或其他套件管理工具

### 安裝與執行

1. **安裝依賴**

```bash
npm install
```

2. **設定環境變數**

本專案需要設定環境變數才能正常運行。請向團隊成員索取 `.env` 檔案，並放在專案根目錄。

3. **啟動開發伺服器**

```bash
# 使用 Bun（推薦，支援hot reload）
bun run dev

# 或使用 Node.js
npm run build
npm start
```

開發伺服器預設運行在 `http://localhost:3001`

### 常用指令

```bash
# 開發
bun run dev              # 啟動開發伺服器
npm run build            # 編譯 TypeScript
npm start                # 執行編譯後的程式碼
```

## Key Features & Implementation

### 1. **Artist Management System**
- **Multi-language Support**: English stage names with optional Chinese translations
- **Group Affiliations**: Support for multiple group memberships per artist
- **Status Workflow**: Pending → Admin Review → Approved/Rejected
- **Birthday Tracking**: Week-based filtering for birthday events

### 2. **Event Management with Advanced Filtering**
- **Multi-Artist Support**: Collaborative support events for group projects
- **Location Integration**: Google Maps API for address validation and coordinates
- **Time-based Filtering**: Range queries for event discovery
- **Real-time Status Updates**: Live status tracking through Firebase

### 3. **Performance-Optimized Image Handling**
- **Cloudflare R2 Integration**: S3-compatible storage with global CDN
- **Sharp Image Processing**: Automatic resizing and format optimization
- **Presigned URLs**: Secure direct upload to reduce server load
- **Multiple Image Support**: Main images + detail galleries per event

### 4. **Smart Caching System**
- **Memory-based Cache**: In-process caching for frequently accessed data
- **TTL Management**: Configurable expiration times per cache type
- **Pattern-based Invalidation**: Bulk cache clearing for related data updates

### 5. **Comprehensive Notification System**
- **Real-time Updates**: Firebase-based push notifications
- **Status Change Tracking**: Automatic notifications for approval/rejection
- **Bulk Operations**: Efficient batch notification processing
- **Read Status Management**: Unread count tracking and management

## Performance Optimizations

### Database Query Optimization
- **Composite Indexes**: Strategic Firestore indexes for complex queries
- **Query Batching**: Reduced read operations through intelligent batching
- **Cache-First Strategy**: Memory cache reduces Firestore reads by ~60%

### Connection Management
- **Firebase Settings**: Optimized connection pooling and keep-alive
- **Timeout Handling**: Custom timeout wrapper for long-running operations
- **Retry Logic**: Automatic retry for transient failures

### API Rate Limiting
- **Tiered Limits**: Different limits for auth, places, and general endpoints
- **Smart Throttling**: Higher limits for legitimate usage patterns
- **Memory Efficiency**: Lightweight in-memory rate limiting