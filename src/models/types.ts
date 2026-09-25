import { Timestamp } from 'firebase-admin/firestore';

export interface Artist {
  id: string;
  slug?: string; // URL-friendly 唯一識別符，一旦設定不隨 stageName 更新
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
  createdByEmail?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CoffeeEvent {
  id: string;
  slug?: string | null;
  artists: Array<{
    id: string;
    name: string;
    slug?: string; // artist slug for navigation
    profileImage?: string; // 新增藝人頭像
  }>; // 改為陣列，支援聯合應援
  title: string;
  description: string;
  location: {
    name: string; // 新增：地點名稱
    address: string;
    city?: string; // 城市（如：臺北市）
    coordinates: {
      lat: number;
      lng: number;
    };
    placeId?: string;
    venueId?: string; // approve 後由後端自動回填，前端不傳
    venueActive?: boolean; // 詳情 API 根據場地當前狀態回傳
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
  reservation?: {
    url?: string;
    startAt?: Timestamp;
  };
  status: 'pending' | 'approved' | 'rejected';
  rejectedReason?: string; // 拒絕原因（status 為 rejected 時使用）
  viewCount?: number;
  createdBy: string;
  createdByEmail?: string;
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

// Venue status: pending (awaiting review) | active | inactive | rejected
export type VenueStatus = 'pending' | 'active' | 'inactive' | 'rejected';

export type CapacityRange = '20以下' | '20-40' | '40-60' | '60以上';

// 場地卡片（列表頁回傳，不含 eventRefs）
export interface Venue {
  id: string;
  name: string;
  address: string;
  region: string;
  lat: number;
  lng: number;
  nearestMrt: string;
  mrtWalkMinutes: number | null;
  capacityRange: CapacityRange | null;
  eventCount: number;
  viewCount?: number;
  coverPhoto: string;
  otherPhotos: string[];
  description: string;
  hostTags: string[];
  status: VenueStatus;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  socialMedia?: {
    threads?: string;
    instagram?: string;
    line?: string;
  };
}

export interface VenueFilterParams {
  region?: string[];
  capacityRange?: CapacityRange;
  search?: string;
  sort?: 'composite' | 'eventCount' | 'name' | 'newest' | 'random'; // 'composite' 為新增值；省略時等同 'composite'
  limit?: number;
  page?: number;
  status?: VenueStatus | 'all';
}

// venueViewDaily collection 的 document schema
// doc id 格式：`{venueId}_{date}`（例：`abc123_2026-09-02`），同一場地同一天寫入同一 doc，靠 doc id 天然去重
export interface VenueViewDailyDoc {
  venueId: string;
  date: string; // UTC 日期字串 YYYY-MM-DD，與 doc id 後綴一致，用於 range query
  count: number;
  expireAt: Timestamp; // 寫入當下 + 90 天；供 Firestore TTL policy 自動清除，不影響查詢正確性
}

// venueService 內部用於排序計算，不對外回傳、不進入公開 Venue 型別，
// 避免污染既有 API response 形狀（getVenues() 回傳前會被去除）
export type VenueWithScore = Venue & { compositeScore: number };

export interface VenuePagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedVenues {
  venues: Venue[];
  pagination: VenuePagination;
}

export interface VenueEventCard {
  id: string;
  title: string;
  artistName: string;
  startDate: string;
  endDate: string;
  coverImage: string;
  slug: string | null;
}

export interface VenueDetail {
  id: string;
  name: string;
  address: string;
  region: string;
  lat: number;
  lng: number;
  placeId: string;
  nearestMrt: string;
  mrtWalkMinutes: number | null;
  capacityRange: CapacityRange | null;
  eventCount: number;
  coverPhoto: string;
  otherPhotos: string[];
  status: VenueStatus;
  description: string;
  hostTags: string[];
  preferredContact?: 'instagram' | 'threads' | 'line' | 'form' | 'other';
  contactUrl?: string;
  socialMedia?: {
    threads?: string;
    instagram?: string;
    line?: string;
  };
  updatedAt?: Timestamp;
  events: VenueEventCard[];
}

export interface CreateVenueData {
  name: string;
  address: string;
  region: string;
  lat?: number;
  lng?: number;
  placeId?: string;
  nearestMrt?: string;
  mrtWalkMinutes?: number | null;
  capacityRange: CapacityRange;
  description?: string;
  hostTags?: string[];
  preferredContact: 'instagram' | 'threads' | 'line' | 'form' | 'other';
  contactUrl?: string;
  coverPhoto: string;
  otherPhotos?: string[];
  socialMedia: {
    threads?: string;
    instagram?: string;
    line?: string;
  };
}

export interface UpdateVenueData {
  name?: string;
  address?: string;
  region?: string;
  status?: VenueStatus;
  nearestMrt?: string;
  mrtWalkMinutes?: number | null;
  capacityRange?: CapacityRange | null;
  description?: string;
  hostTags?: string[];
  preferredContact?: 'instagram' | 'threads' | 'line' | 'form' | 'other';
  contactUrl?: string;
  coverPhoto?: string;
  otherPhotos?: string[];
  socialMedia?: {
    threads?: string;
    instagram?: string;
    line?: string;
  };
}

// Batch review request item
export interface VenueBatchReviewItem {
  venueId: string;
  status: 'active' | 'rejected';
}

// Batch status request item
export interface VenueBatchStatusItem {
  venueId: string;
  status: 'active' | 'inactive';
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
    city?: string; // 城市（如：臺北市）
    coordinates: {
      lat: number;
      lng: number;
    };
    placeId?: string;
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
  reservation?: {
    url?: string;
    startAt?: Date | string | { _seconds: number; _nanoseconds: number };
  };
}

// 編輯活動資料（不包含 artistIds）
export interface UpdateEventData {
  title?: string;
  description?: string;
  location?: {
    name: string; // 地點名稱
    address: string;
    city?: string; // 城市（如：臺北市）
    coordinates: {
      lat: number;
      lng: number;
    };
    placeId?: string;
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
  reservation?: {
    url?: string;
    startAt?: Date | string | { _seconds: number; _nanoseconds: number };
  } | null; // null = 明確清除整個 reservation
}

// 新增篩選參數介面
export interface EventFilterParams {
  // 篩選參數
  search?: string; // 搜尋標題、藝人名稱、地址、描述
  artistId?: string; // 特定藝人ID
  status?: 'pending' | 'approved' | 'rejected'; // 審核狀態
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

// datetime 欄位的 API 回應格式（ISO 8601 字串），與 CoffeeEvent.datetime（Firestore Timestamp）分開，
// 因為 CoffeeEvent 同時被內部服務邏輯使用，不能直接改動其欄位型別
export interface EventDatetimeResponse {
  start: string; // ISO timestamp
  end: string; // ISO timestamp
}

// 活動列表回應格式（GET /events：datetime 為 ISO 字串，見 eventSanitizer.serializeEventsDatetime）
export interface EventsResponse {
  events: (Omit<CoffeeEvent, 'datetime'> & { datetime: EventDatetimeResponse })[];
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
    slug?: string | null;
    title: string;
    mainImage?: string;
    location: {
      name: string;
      address: string;
      city?: string;
      coordinates: { lat: number; lng: number };
    };
    datetime: {
      start: string; // ISO timestamp
      end: string; // ISO timestamp
    };
    isFavorited: boolean;
  }[];
  total: number;
}

// 用戶投稿列表：單一資源統計（僅該資源）
export interface UserSubmissionResourceSummary {
  total: number;
  pending: number;
  approved: number;
}

export interface UserSubmissionsPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface UserSubmissionsEventsListResponse {
  events: CoffeeEvent[];
  summary: UserSubmissionResourceSummary;
  pagination: UserSubmissionsPagination;
}

export interface UserSubmissionsArtistsListResponse {
  artists: Artist[];
  summary: UserSubmissionResourceSummary;
  pagination: UserSubmissionsPagination;
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

// 活動列表回應格式（帶收藏狀態；GET /events?checkFavorite=true：datetime 為 ISO 字串）
export interface EventsResponseWithFavorite {
  events: (Omit<CoffeeEventWithFavorite, 'datetime'> & { datetime: EventDatetimeResponse })[];
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
