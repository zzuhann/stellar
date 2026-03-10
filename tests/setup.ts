import { cache } from '../src/utils/cache';

// 清理每個測試的快取狀態
beforeEach(() => {
  cache.clear();
});
