import { Timestamp } from 'firebase-admin/firestore';

export interface Artist {
  id: string;
  stageName: string; // 英文藝名（主要顯示）
  stageNameZh?: string; // 中文藝名（可選）
  groupNames?: string[]; // 團名列表（可選，最多5個）
  realName?: string; // 本名（可選）
  birthday?: string; // 生日 (YYYY-MM-DD 格式)
  profileImage?: string; // 照片 URL
  status: 'pending' | 'approved' | 'rejected' | 'exists';
  rejectedReason?: string; // 拒絕原因（status 為 rejected 時使用）
  activeEventIds?: string[]; // 進行中的活動 ID 列表
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CoffeeEvent {
  id: string;
  artists: Array<{
    id: string;
    name: string;
    profileImage?: string; // 🆕 新增藝人頭像
  }>; // 改為陣列，支援聯合應援
  title: string;
  description: string;
  location: {
    name: string; // 新增：地點名稱
    address: string;
    coordinates: {
      lat: number;
      lng: number;
    };
  };
  datetime: {
    start: Timestamp;
    end: Timestamp;
  };
  socialMedia: {
    instagram?: string;
    x?: string; // 替代 twitter
    threads?: string;
  };
  mainImage?: string; // 新增：主要圖片 URL
  detailImage?: string[]; // 新增：詳細圖片 URL 陣列
  status: 'pending' | 'approved' | 'rejected';
  rejectedReason?: string; // 拒絕原因（status 為 rejected 時使用）
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface User {
  uid: string;
  email: string;
  displayName?: string;
  role: 'user' | 'admin';
  isBlocked: boolean;
  createdAt: Timestamp;
}

// 更新用戶資料
export interface UpdateUserData {
  displayName?: string;
}

export interface CreateArtistData {
  stageName: string; // 英文藝名（必填）
  stageNameZh?: string; // 中文藝名（可選）
  groupNames?: string[]; // 團名列表（可選，最多5個）
  realName?: string; // 本名（可選）
  birthday?: string; // 生日（可選，YYYY-MM-DD）
  profileImage?: string; // 照片 URL（可選）
}

// 編輯藝人資料
export interface UpdateArtistData {
  stageName?: string; // 英文藝名
  stageNameZh?: string; // 中文藝名（可選）
  groupNames?: string[]; // 團名列表（可選，最多5個）
  realName?: string; // 本名（可選）
  birthday?: string; // 生日（可選，YYYY-MM-DD）
  profileImage?: string; // 照片 URL（可選）
}

// 管理員審核時的更新資料
export interface AdminArtistUpdate {
  groupNames?: string[]; // 管理員可以在審核通過時設定團名列表
}

// 藝人篩選參數
export interface ArtistFilterParams {
  status?: 'approved' | 'pending' | 'rejected'; // 狀態篩選
  createdBy?: string; // 創建者篩選
  birthdayWeek?: {
    startDate: string; // YYYY-MM-DD 格式，該週的開始日期
    endDate: string; // YYYY-MM-DD 格式，該週的結束日期
  }; // 生日週篩選
  search?: string; // 搜尋英文藝名、中文藝名、團名、本名
  sortBy?: 'stageName' | 'coffeeEventCount' | 'createdAt' | 'birthday'; // 排序方式
  sortOrder?: 'asc' | 'desc'; // 排序順序，預設 desc
}

export interface CreateEventData {
  artistIds: string[]; // 改為陣列，支援聯合應援
  title: string;
  description: string;
  location: {
    name: string; // 地點名稱
    address: string;
    coordinates: {
      lat: number;
      lng: number;
    };
  };
  datetime: {
    start: Date | string; // 支援 Date 物件或 ISO 字串
    end: Date | string; // 支援 Date 物件或 ISO 字串
  };
  socialMedia: {
    instagram?: string;
    x?: string; // X (前 Twitter)
    threads?: string;
  };
  mainImage?: string; // 主要圖片 URL
  detailImage?: string[]; // 詳細圖片 URL 陣列
}

// 編輯活動資料（不包含 artistIds）
export interface UpdateEventData {
  title?: string;
  description?: string;
  location?: {
    name: string; // 地點名稱
    address: string;
    coordinates: {
      lat: number;
      lng: number;
    };
  };
  datetime?: {
    start: Date | string;
    end: Date | string;
  };
  socialMedia?: {
    instagram?: string;
    x?: string; // X (前 Twitter)
    threads?: string;
  };
  mainImage?: string; // 主要圖片 URL
  detailImage?: string[]; // 詳細圖片 URL 陣列
}

// 新增篩選參數介面
export interface EventFilterParams {
  // 篩選參數
  search?: string; // 搜尋標題、藝人名稱、地址、描述
  artistId?: string; // 特定藝人ID
  status?: 'all' | 'pending' | 'approved' | 'rejected'; // 審核狀態
  region?: string; // 地區名稱（台北市、新北市等）
  createdBy?: string; // 創建者 UID（篩選用戶自己的投稿）
  startTimeFrom?: string; // 開始時間範圍（從）
  startTimeTo?: string; // 開始時間範圍（到）

  // 分頁參數
  page?: number; // 頁數，預設1
  limit?: number; // 每頁筆數，預設50

  // 排序參數
  sortBy?: 'title' | 'startTime' | 'createdAt'; // 排序方式
  sortOrder?: 'asc' | 'desc'; // 排序順序，預設 desc
}

// 活動列表回應格式
export interface EventsResponse {
  events: CoffeeEvent[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  filters: {
    search?: string;
    artistId?: string;
    status?: string;
    region?: string;
  };
}

// 地圖資料參數
export interface MapDataParams {
  status?: 'active' | 'upcoming' | 'all'; // 預設 'active'
  bounds?: string; // "lat1,lng1,lat2,lng2" 地圖邊界（可選）
  center?: string; // "lat,lng" 地圖中心點（配合 zoom 使用）
  zoom?: number; // 縮放等級（配合 center 計算視窗範圍）
  // 新增篩選參數
  search?: string; // 搜尋標題、藝人名稱、地址、描述
  artistId?: string; // 特定藝人ID
  region?: string; // 地區名稱（台北市、新北市等）
}

// 地圖資料回應格式
export interface MapDataResponse {
  events: {
    id: string;
    title: string;
    mainImage?: string;
    location: {
      name: string;
      address: string;
      coordinates: { lat: number; lng: number };
    };
    datetime: {
      start: string; // ISO timestamp
      end: string; // ISO timestamp
    };
  }[];
  total: number;
}

// 用戶投稿資料回應格式
export interface UserSubmissionsResponse {
  artists: Artist[];
  events: CoffeeEvent[];
  summary: {
    totalArtists: number;
    totalEvents: number;
    pendingArtists: number;
    pendingEvents: number;
    approvedArtists: number;
    approvedEvents: number;
  };
}

// 用戶收藏
export interface UserFavorite {
  id: string;
  userId: string;
  eventId: string;
  createdAt: Timestamp;
}

// 收藏篩選參數
export interface FavoriteFilterParams {
  sort?: 'favoritedAt' | 'startTime';
  sortOrder?: 'asc' | 'desc';
  status?: 'notEnded' | 'active' | 'upcoming' | 'ended' | 'all'; // 預設 notEnded
  artistIds?: string[];
  page?: number;
  limit?: number;
}

// 收藏列表回應格式
export interface FavoritesResponse {
  favorites: Array<{
    favorite: UserFavorite;
    event: CoffeeEvent;
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// 帶有收藏狀態的活動
export interface CoffeeEventWithFavorite extends CoffeeEvent {
  isFavorited?: boolean;
}

// 活動列表回應格式（帶收藏狀態）
export interface EventsResponseWithFavorite {
  events: CoffeeEventWithFavorite[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  filters: {
    search?: string;
    artistId?: string;
    status?: string;
    region?: string;
  };
}
