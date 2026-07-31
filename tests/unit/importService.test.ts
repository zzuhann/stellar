import { ImportService } from '../../src/services/importService';

jest.mock('../../src/services/placesService', () => ({
  resolveLocation: jest.fn(),
}));

import { resolveLocation } from '../../src/services/placesService';

const mockResolveLocation = resolveLocation as jest.Mock;

function geminiOkResponse(payload: unknown): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
    }),
    { status: 200 }
  );
}

function baseExtraction(overrides: Record<string, unknown> = {}) {
  return {
    title: '生日應援活動',
    artistName: '小明',
    eventDateStart: '2026-08-01',
    eventDateEnd: null,
    locationName: '某咖啡廳',
    locationAddress: '台北市大安區',
    socialHandles: ['instagram:@example', 'threads:@example2'],
    redemptionCondition: '消費飲品即可兌換小卡',
    ...overrides,
  };
}

describe('ImportService.parseCaption', () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.GEMINI_API_KEY;
  let service: ImportService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test-key';
    service = new ImportService();
    mockResolveLocation.mockResolvedValue({
      name: '某咖啡廳',
      address: '台北市大安區某路 1 號',
      city: '台北',
      coordinates: { lat: 25.03, lng: 121.56 },
      placeId: 'place-123',
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.GEMINI_API_KEY = originalApiKey;
  });

  it('回傳格式正確時，成功解析並套用欄位對應', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(geminiOkResponse(baseExtraction())) as unknown as typeof fetch;

    const result = await service.parseCaption('貼文文案原文');

    expect(result.success).toBe(true);
    expect(result.parsed).toEqual({
      title: '生日應援活動',
      artistName: '小明',
      eventDateStart: '2026-08-01',
      eventDateEnd: null,
      location: {
        name: '某咖啡廳',
        address: '台北市大安區某路 1 號',
        city: '台北',
        coordinates: { lat: 25.03, lng: 121.56 },
        placeId: 'place-123',
      },
      socialMedia: { instagram: '@example', threads: '@example2' },
      redemptionCondition: '消費飲品即可兌換小卡',
    });
    expect(mockResolveLocation).toHaveBeenCalledWith('某咖啡廳 台北市大安區');
  });

  it('locationName／locationAddress 皆為 null 時，不呼叫 Places API，location 回 null', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        geminiOkResponse(baseExtraction({ locationName: null, locationAddress: null }))
      ) as unknown as typeof fetch;

    const result = await service.parseCaption('貼文文案原文');

    expect(result.success).toBe(true);
    expect(result.parsed?.location).toBeNull();
    expect(mockResolveLocation).not.toHaveBeenCalled();
  });

  it('socialHandles 為空陣列時，socialMedia 回 null', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        geminiOkResponse(baseExtraction({ socialHandles: [] }))
      ) as unknown as typeof fetch;

    const result = await service.parseCaption('貼文文案原文');

    expect(result.parsed?.socialMedia).toBeNull();
  });

  it('eventDateEnd 早於 eventDateStart 時，保留 start、把 end 丟回 null', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        geminiOkResponse(
          baseExtraction({ eventDateStart: '2026-08-10', eventDateEnd: '2026-08-01' })
        )
      ) as unknown as typeof fetch;

    const result = await service.parseCaption('貼文文案原文');

    expect(result.parsed?.eventDateStart).toBe('2026-08-10');
    expect(result.parsed?.eventDateEnd).toBeNull();
  });

  it('日期格式不符（不是 YYYY-MM-DD）時，該欄位丟回 null', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        geminiOkResponse(baseExtraction({ eventDateStart: '2026/08/01' }))
      ) as unknown as typeof fetch;

    const result = await service.parseCaption('貼文文案原文');

    expect(result.parsed?.eventDateStart).toBeNull();
  });

  it('日期是不存在的日曆日（例如 2/30）時，該欄位丟回 null', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        geminiOkResponse(baseExtraction({ eventDateStart: '2026-02-30' }))
      ) as unknown as typeof fetch;

    const result = await service.parseCaption('貼文文案原文');

    expect(result.parsed?.eventDateStart).toBeNull();
  });

  it('Gemini 回傳內容不符 schema（缺欄位）時，回傳 parse_failed', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(geminiOkResponse({ title: '只有標題' })) as unknown as typeof fetch;

    const result = await service.parseCaption('貼文文案原文');

    expect(result.success).toBe(false);
    expect(result.reason).toBe('parse_failed');
  });

  it('Gemini 回傳的 text 不是合法 JSON 時，回傳 parse_failed', async () => {
    const malformedBody = {
      candidates: [{ content: { parts: [{ text: '不是 JSON{{{' }] } }],
    };
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(malformedBody), { status: 200 })
      ) as unknown as typeof fetch;

    const result = await service.parseCaption('貼文文案原文');

    expect(result.success).toBe(false);
    expect(result.reason).toBe('parse_failed');
  });

  it('Gemini 回應缺少 candidates 時，回傳 parse_failed', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200 })
      ) as unknown as typeof fetch;

    const result = await service.parseCaption('貼文文案原文');

    expect(result.success).toBe(false);
    expect(result.reason).toBe('parse_failed');
  });

  it('Gemini 回傳 429 時，回傳 quota_exceeded，不重試', async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: 'quota' }), { status: 429 }));
    global.fetch = mockFetch as unknown as typeof fetch;

    const result = await service.parseCaption('貼文文案原文');

    expect(result.success).toBe(false);
    expect(result.reason).toBe('quota_exceeded');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('Gemini 回傳其他 4xx/5xx 時，回傳 gemini_unavailable，不重試', async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: 'server error' }), { status: 500 }));
    global.fetch = mockFetch as unknown as typeof fetch;

    const result = await service.parseCaption('貼文文案原文');

    expect(result.success).toBe(false);
    expect(result.reason).toBe('gemini_unavailable');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('網路層持續失敗時，重試後回傳 gemini_unavailable', async () => {
    const mockFetch = jest.fn().mockRejectedValue(new TypeError('fetch failed'));
    global.fetch = mockFetch as unknown as typeof fetch;

    const result = await service.parseCaption('貼文文案原文');

    expect(result.success).toBe(false);
    expect(result.reason).toBe('gemini_unavailable');
    expect(mockFetch).toHaveBeenCalledTimes(2); // parseCaption 呼叫 maxAttempts: 2
  });
});
