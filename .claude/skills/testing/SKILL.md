---
name: testing
description: 後端單元測試規範（Jest + ts-jest）。涵蓋測試檔位置、mock 模式、Firestore mock、Zod schema 測試、setup。使用時機：新增後端單元測試。
---

# 後端單元測試規範

## 工具

- **Runner**：Jest（`bun run test`）
- **Transformer**：ts-jest
- **環境**：node
- **指令**：`bun run test:unit`（只跑 `tests/unit/`）

## 檔案位置

```
tests/
├── unit/          # 單元測試（不依賴 Firebase）
│   └── *.test.ts
├── integration/   # 整合測試（依賴真實 Firebase）
└── setup.ts       # 全域 beforeEach：cache.clear()
```

單元測試放 `tests/unit/`，integration 放 `tests/integration/`。

## 基本結構

```typescript
import { myFunction } from '../../src/utils/myFunction';

describe('myFunction', () => {
  it('描述預期行為', () => {
    const result = myFunction('input');
    expect(result).toBe('expected');
  });

  it('非同步行為', async () => {
    await expect(asyncFn()).resolves.toBe('value');
    await expect(failingFn()).rejects.toThrow('error');
  });
});
```

## Zod Schema 測試

直接 import schema，呼叫 `.safeParse()`：

```typescript
import { venueSchemas } from '../../src/middleware/validation';

const regionSchema = venueSchemas.create.shape.region;

describe('region validation', () => {
  test.each([
    ['台北', '台北'],
    ['臺北', '台北'], // normalize
  ])('accepts "%s" and normalizes to "%s"', (input, expected) => {
    const result = regionSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(expected);
  });

  it('rejects invalid value', () => {
    expect(regionSchema.safeParse('東京').success).toBe(false);
  });
});
```

## Firestore Mock（Service 測試）

`jest.mock` 放最上方（會被 hoist），在 `beforeEach` 透過 `jest.requireMock` 取得 mock instance 再設定行為，**最後**才 `new Service()`（class property 初始化時會讀 `db.collection`）：

```typescript
import { VenueService } from '../../src/services/venueService';

jest.mock('../../src/config/firebase', () => ({
  hasFirebaseConfig: true,
  withTimeoutAndRetry: jest.fn().mockImplementation((fn: () => unknown) => fn()),
  db: {
    collection: jest.fn(),
  },
}));

describe('VenueService', () => {
  let service: VenueService;
  const mockDelete = jest.fn();
  const mockGet = jest.fn();
  const mockDocRef = { get: mockGet, delete: mockDelete };

  beforeEach(() => {
    jest.clearAllMocks();
    const firebase = jest.requireMock('../../src/config/firebase');
    (firebase.db.collection as jest.Mock).mockReturnValue({
      doc: jest.fn(() => mockDocRef),
    });
    (firebase.withTimeoutAndRetry as jest.Mock).mockImplementation((fn: () => unknown) => fn());
    service = new VenueService(); // 最後才建立，確保 collection 已設好
  });

  it('場地不存在 → not_found', async () => {
    mockGet.mockResolvedValue({ exists: false });
    await expect(service.permanentDeleteVenue('id')).resolves.toBe('not_found');
  });
});
```

**注意**：`jest.mock` factory 中的變數因 hoist 無法引用外部 `const`，一律在 factory 內或用 `jest.requireMock` 在 `beforeEach` 取得。

## setup.ts

`tests/setup.ts` 在每個 test 前清空 cache，不需要在個別測試中重複呼叫：

```typescript
import { cache } from '../src/utils/cache';
beforeEach(() => { cache.clear(); });
```
