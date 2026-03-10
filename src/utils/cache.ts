interface CacheItem<T> {
  data: T;
  expires: number;
}

class MemoryCache {
  private cache = new Map<string, CacheItem<unknown>>();
  private pendingRequests = new Map<string, Promise<unknown>>();

  // 帶 Lock 的快取取得，防止快取過期時的雪崩效應
  async getWithLock<T>(key: string, fetchFn: () => Promise<T>, ttlMinutes: number): Promise<T> {
    // 1. 快取有效，直接返回
    const cached = this.get<T>(key);
    if (cached !== null) return cached;

    // 2. 有人正在查詢中，等待結果
    const pending = this.pendingRequests.get(key);
    if (pending) {
      console.log(`⏳ Cache WAITING: ${key}`);
      return pending as Promise<T>;
    }

    // 3. 沒人在查，執行查詢並設定 Lock
    console.log(`🔒 Cache LOCK: ${key}`);
    const promise = fetchFn()
      .then(result => {
        this.set(key, result, ttlMinutes);
        return result;
      })
      .finally(() => {
        this.pendingRequests.delete(key);
        console.log(`🔓 Cache UNLOCK: ${key}`);
      });

    this.pendingRequests.set(key, promise);
    return promise;
  }

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
