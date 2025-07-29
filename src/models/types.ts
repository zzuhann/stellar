import { Timestamp } from 'firebase-admin/firestore';

export interface Artist {
  id: string;
  stageName: string; // 藝名（主要顯示）
  realName?: string; // 本名（可選）
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
  birthday?: string; // 生日（可選，YYYY-MM-DD）
  profileImage?: string; // 照片 URL（可選）
}

export interface CreateEventData {
  artistId: string;
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
    start: Date;
    end: Date;
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
