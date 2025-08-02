import { Timestamp } from 'firebase-admin/firestore';

export interface Artist {
  id: string;
  stageName: string; // 藝名（主要顯示）
  realName?: string; // 本名（可選）
  groupName?: string; // 團體名稱（可選，例如："BLACKPINK", "BTS", "TWICE"）
  birthday?: string; // 生日 (YYYY-MM-DD 格式)
  profileImage?: string; // 照片 URL
  status: 'pending' | 'approved' | 'rejected';
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CoffeeEvent {
  id: string;
  artistId: string;
  artistName: string; // 冗餘儲存，避免每次都要 join
  title: string;
  description: string;
  location: {
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
    twitter?: string;
    threads?: string;
  };
  images: string[];
  thumbnail?: string; // 縮圖 URL (200x200)
  markerImage?: string; // Marker 圖片 URL (48x48)
  supportProvided?: boolean;
  requiresReservation?: boolean;
  onSiteReservation?: boolean;
  amenities?: string[];
  status: 'pending' | 'approved' | 'rejected';
  isDeleted: boolean;
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

export interface CreateArtistData {
  stageName: string; // 藝名（必填）
  realName?: string; // 本名（可選）
  groupName?: string; // 團體名稱（可選）
  birthday?: string; // 生日（可選，YYYY-MM-DD）
  profileImage?: string; // 照片 URL（可選）
}

// 藝人篩選參數
export interface ArtistFilterParams {
  status?: 'approved' | 'pending' | 'rejected'; // 狀態篩選
  createdBy?: string; // 創建者篩選
  birthdayWeek?: {
    startDate: string; // YYYY-MM-DD 格式，該週的開始日期
    endDate: string; // YYYY-MM-DD 格式，該週的結束日期
  }; // 生日週篩選
  search?: string; // 搜尋藝名、本名、團體名稱
  sortBy?: 'stageName' | 'coffeeEventCount' | 'createdAt'; // 排序方式
  sortOrder?: 'asc' | 'desc'; // 排序順序，預設 desc
}

// 藝人回應格式（包含額外計算欄位）
export interface ArtistWithStats extends Artist {
  coffeeEventCount: number; // 進行中的生咖活動數量
}

export interface CreateEventData {
  artistId: string;
  artistName?: string; // 藝人名稱（會自動從 Artist 取得，但允許手動提供）
  title: string;
  description: string;
  location: {
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
    twitter?: string;
    threads?: string;
  };
  supportProvided?: boolean;
  requiresReservation?: boolean;
  onSiteReservation?: boolean;
  amenities?: string[];
}

// 編輯活動資料（不包含 artistId 和 artistName）
export interface UpdateEventData {
  title?: string;
  description?: string;
  location?: {
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
    twitter?: string;
    threads?: string;
  };
  supportProvided?: boolean;
  requiresReservation?: boolean;
  onSiteReservation?: boolean;
  amenities?: string[];
  thumbnail?: string;
  markerImage?: string;
}

// 新增篩選參數介面
export interface EventFilterParams {
  // 篩選參數
  search?: string; // 搜尋標題、藝人名稱、地址、描述
  artistId?: string; // 特定藝人ID
  status?: 'all' | 'active' | 'upcoming' | 'ended'; // 時間狀態
  region?: string; // 地區名稱（台北市、新北市等）
  createdBy?: string; // 創建者 UID（篩選用戶自己的投稿）

  // 分頁參數
  page?: number; // 頁數，預設1
  limit?: number; // 每頁筆數，預設50
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
  zoom?: number; // 縮放等級（未來聚合用）
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
    artistName: string;
    coordinates: { lat: number; lng: number };
    status: 'active' | 'upcoming';
    thumbnail?: string; // 為未來自定義 marker 準備
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
