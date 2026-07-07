import { fetchWithRetry } from '../../src/controllers/placesController';

describe('fetchWithRetry', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('網路層失敗一次後成功時，會重試並回傳最終成功的 Response', async () => {
    const okResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
    const mockFetch = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(okResponse);
    global.fetch = mockFetch as unknown as typeof fetch;

    const response = await fetchWithRetry(
      'https://example.com',
      {},
      { maxAttempts: 3, delayMs: 1, timeoutMs: 1000 }
    );

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(200);
  });

  it('Google API 回傳明確的業務錯誤（如 400）時，不會重試，只呼叫一次 fetch', async () => {
    const badRequestResponse = new Response(JSON.stringify({ error: 'invalid input' }), {
      status: 400,
    });
    const mockFetch = jest.fn().mockResolvedValue(badRequestResponse);
    global.fetch = mockFetch as unknown as typeof fetch;

    const response = await fetchWithRetry(
      'https://example.com',
      {},
      { maxAttempts: 3, delayMs: 1, timeoutMs: 1000 }
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(400);
    expect(response.ok).toBe(false);
  });

  it('網路層持續失敗超過重試次數時，最終拋出最後一次的錯誤', async () => {
    const mockFetch = jest.fn().mockRejectedValue(new TypeError('fetch failed'));
    global.fetch = mockFetch as unknown as typeof fetch;

    await expect(
      fetchWithRetry('https://example.com', {}, { maxAttempts: 3, delayMs: 1, timeoutMs: 1000 })
    ).rejects.toThrow('fetch failed');

    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
