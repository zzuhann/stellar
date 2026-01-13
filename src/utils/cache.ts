interface CacheItem<T> {
  data: T;
  expires: number;
}

class MemoryCache {
  private cache = new Map<string, CacheItem<unknown>>();

  set<T>(key: string, data: T, ttlMinutes: number): void {
    const expires = Date.now() + ttlMinutes * 60 * 1000;
    this.cache.set(key, { data, expires });
    console.log(`💾 Cache SET: ${key} (TTL: ${ttlMinutes}min)`);
  }

  get<T>(key: string): T | null {
    const item = this.cache.get(key);

    if (!item) {
      console.log(`🔍 Cache MISS: ${key}`);
      return null;
    }

    // 檢查是否過期
    if (Date.now() > item.expires) {
      console.log(`⏰ Cache EXPIRED: ${key}`);
      this.cache.delete(key);
      return null;
    }

    console.log(`✅ Cache HIT: ${key}`);
    return item.data as T;
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  // 清除特定 pattern 的 keys
  clearPattern(pattern: string): void {
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
      }
    }
  }

  // 取得快取統計
  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}

export const cache = new MemoryCache();
