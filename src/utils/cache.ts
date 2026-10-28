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
      return pending as Promise<T>;
    }

    // 3. 沒人在查，執行查詢並設定 Lock
    const promise: Promise<T> = fetchFn()
      .then(result => {
        // Invalidated mid-fetch (e.g. an event was approved): the result may predate the write.
        if (this.pendingRequests.get(key) === promise) this.set(key, result, ttlMinutes);
        return result;
      })
      .finally(() => {
        if (this.pendingRequests.get(key) === promise) this.pendingRequests.delete(key);
      });

    this.pendingRequests.set(key, promise);
    return promise;
  }

  set<T>(key: string, data: T, ttlMinutes: number): void {
    const expires = Date.now() + ttlMinutes * 60 * 1000;
    this.cache.set(key, { data, expires });
  }

  get<T>(key: string): T | null {
    const item = this.cache.get(key);

    if (!item) {
      return null;
    }

    // 檢查是否過期
    if (Date.now() > item.expires) {
      this.cache.delete(key);
      return null;
    }

    return item.data as T;
  }

  // Invalidation also drops in-flight getWithLock fetches so they can't store stale results.
  delete(key: string): void {
    this.cache.delete(key);
    this.pendingRequests.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.pendingRequests.clear();
  }

  // 清除特定 pattern 的 keys
  clearPattern(pattern: string): void {
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
      }
    }
    for (const key of this.pendingRequests.keys()) {
      if (key.includes(pattern)) {
        this.pendingRequests.delete(key);
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
