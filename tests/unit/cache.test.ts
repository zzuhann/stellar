import { cache } from '../../src/utils/cache';

describe('MemoryCache', () => {
  describe('getWithLock', () => {
    it('should only call fetchFn once for concurrent requests', async () => {
      const fetchFn = jest.fn().mockImplementation(
        () =>
          new Promise(resolve => {
            setTimeout(() => resolve('data'), 100);
          })
      );

      // 同時發起 3 個請求
      const [r1, r2, r3] = await Promise.all([
        cache.getWithLock('key', fetchFn, 60),
        cache.getWithLock('key', fetchFn, 60),
        cache.getWithLock('key', fetchFn, 60),
      ]);

      expect(fetchFn).toHaveBeenCalledTimes(1); // 只呼叫一次
      expect(r1).toBe('data');
      expect(r2).toBe('data');
      expect(r3).toBe('data');
    });

    it('should use cache on second request', async () => {
      const fetchFn = jest.fn().mockResolvedValue('data');

      await cache.getWithLock('key', fetchFn, 60);
      const result = await cache.getWithLock('key', fetchFn, 60);

      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(result).toBe('data');
    });

    it('should call fetchFn again after cache expires', async () => {
      const fetchFn = jest.fn().mockResolvedValue('data');

      // 使用極短的 TTL（0.001 分鐘 = 60ms）
      await cache.getWithLock('key', fetchFn, 0.001);

      // 等待超過 TTL
      await new Promise(resolve => setTimeout(resolve, 100));

      await cache.getWithLock('key', fetchFn, 60);

      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('should handle fetchFn errors gracefully', async () => {
      const fetchFn = jest.fn().mockRejectedValue(new Error('fetch error'));

      await expect(cache.getWithLock('key', fetchFn, 60)).rejects.toThrow('fetch error');

      // Lock 應該被釋放，允許重試
      const fetchFn2 = jest.fn().mockResolvedValue('recovered');
      const result = await cache.getWithLock('key', fetchFn2, 60);

      expect(result).toBe('recovered');
    });

    it('should return different results for different keys', async () => {
      const fetchFn1 = jest.fn().mockResolvedValue('data1');
      const fetchFn2 = jest.fn().mockResolvedValue('data2');

      const [r1, r2] = await Promise.all([
        cache.getWithLock('key1', fetchFn1, 60),
        cache.getWithLock('key2', fetchFn2, 60),
      ]);

      expect(r1).toBe('data1');
      expect(r2).toBe('data2');
      expect(fetchFn1).toHaveBeenCalledTimes(1);
      expect(fetchFn2).toHaveBeenCalledTimes(1);
    });
  });

  describe('cache stampede prevention', () => {
    it('should handle high concurrency without multiple fetches', async () => {
      const fetchFn = jest
        .fn()
        .mockImplementation(() => new Promise(resolve => setTimeout(() => resolve('data'), 50)));

      // 模擬 100 個同時到達的請求（如快取過期瞬間的流量尖峰）
      const concurrentRequests = 100;
      const requests = Array(concurrentRequests)
        .fill(null)
        .map(() => cache.getWithLock('stampede-key', fetchFn, 60));

      const results = await Promise.all(requests);

      // 無論多少並發請求，fetchFn 只應被呼叫一次
      expect(fetchFn).toHaveBeenCalledTimes(1);
      // 所有請求都應該得到相同的結果
      results.forEach(result => expect(result).toBe('data'));
    });

    it('should share the same promise reference for concurrent requests', async () => {
      const sharedData = { value: 'shared' };
      const fetchFn = jest
        .fn()
        .mockImplementation(
          () => new Promise(resolve => setTimeout(() => resolve(sharedData), 50))
        );

      const [r1, r2, r3] = await Promise.all([
        cache.getWithLock('shared-key', fetchFn, 60),
        cache.getWithLock('shared-key', fetchFn, 60),
        cache.getWithLock('shared-key', fetchFn, 60),
      ]);

      // 驗證所有請求返回完全相同的物件引用（不是 copy）
      expect(r1).toBe(r2);
      expect(r2).toBe(r3);
      expect(r1).toBe(sharedData);
    });

    it('should allow new fetch after previous fetch completes and cache expires', async () => {
      let callCount = 0;
      const fetchFn = jest.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve(`data-${callCount}`);
      });

      // 第一次請求
      const result1 = await cache.getWithLock('expire-key', fetchFn, 0.001); // 60ms TTL
      expect(result1).toBe('data-1');

      // 等待快取過期
      await new Promise(resolve => setTimeout(resolve, 100));

      // 第二波並發請求（模擬快取過期後的 stampede）
      const [r2, r3, r4] = await Promise.all([
        cache.getWithLock('expire-key', fetchFn, 60),
        cache.getWithLock('expire-key', fetchFn, 60),
        cache.getWithLock('expire-key', fetchFn, 60),
      ]);

      // 過期後的並發請求也只應觸發一次 fetch
      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(r2).toBe('data-2');
      expect(r3).toBe('data-2');
      expect(r4).toBe('data-2');
    });
  });

  describe('basic cache operations', () => {
    it('should set and get values correctly', () => {
      cache.set('test-key', { value: 123 }, 60);
      const result = cache.get<{ value: number }>('test-key');
      expect(result).toEqual({ value: 123 });
    });

    it('should return null for non-existent keys', () => {
      const result = cache.get('non-existent');
      expect(result).toBeNull();
    });

    it('should delete keys correctly', () => {
      cache.set('to-delete', 'value', 60);
      cache.delete('to-delete');
      expect(cache.get('to-delete')).toBeNull();
    });

    it('should clear all keys', () => {
      cache.set('key1', 'value1', 60);
      cache.set('key2', 'value2', 60);
      cache.clear();
      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBeNull();
    });

    it('should clear keys matching pattern', () => {
      cache.set('events:active', 'value1', 60);
      cache.set('events:pending', 'value2', 60);
      cache.set('other:key', 'value3', 60);

      cache.clearPattern('events:');

      expect(cache.get('events:active')).toBeNull();
      expect(cache.get('events:pending')).toBeNull();
      expect(cache.get('other:key')).toBe('value3');
    });

    it('should return correct stats', () => {
      cache.set('key1', 'value1', 60);
      cache.set('key2', 'value2', 60);

      const stats = cache.getStats();

      expect(stats.size).toBe(2);
      expect(stats.keys).toContain('key1');
      expect(stats.keys).toContain('key2');
    });
  });
});
