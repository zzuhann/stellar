/**
 * 幫 Google Places API 的 fetch 呼叫加上 timeout 與重試。
 * 只重試網路層失敗（fetch 直接 throw，例如連線被 abort、DNS 失敗）；
 * Google API 回傳的 4xx/5xx 業務錯誤會正常回傳 Response（ok: false），不會走進 catch，
 * 因此不會被無意義地重試。
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: { timeoutMs?: number; maxAttempts?: number; delayMs?: number } = {}
): Promise<globalThis.Response> {
  const { timeoutMs = 8000, maxAttempts = 3, delayMs = 300 } = options;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      return response;
    } catch (error) {
      clearTimeout(timer);
      lastError = error as Error;
      console.warn(`Google Places API fetch attempt ${attempt}/${maxAttempts} failed:`, {
        error: lastError.message,
        isTimeout: lastError.name === 'AbortError',
        attempt,
        willRetry: attempt < maxAttempts,
      });

      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
      }
    }
  }

  throw lastError ?? new Error('fetchWithRetry failed with no error captured');
}
