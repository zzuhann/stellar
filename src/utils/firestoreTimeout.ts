/**
 * Firestore 查詢超時和重試包裝函數
 * 解決間歇性 CORS 錯誤問題
 */

export class FirestoreTimeoutError extends Error {
  constructor(timeout: number) {
    super(`Firestore query timed out after ${timeout}ms`);
    this.name = 'FirestoreTimeoutError';
  }
}

export class FirestoreRetryError extends Error {
  readonly cause: Error;

  constructor(attempts: number, lastError: Error) {
    super(`Firestore query failed after ${attempts} attempts: ${lastError.message}`);
    this.name = 'FirestoreRetryError';
    this.cause = lastError;
  }
}

/**
 * 為 Firestore 查詢添加超時機制
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number = 15000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new FirestoreTimeoutError(timeoutMs));
      }, timeoutMs);
    }),
  ]);
}

/**
 * 為 Firestore 查詢添加重試機制
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxAttempts: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      console.warn(`Firestore operation attempt ${attempt}/${maxAttempts} failed:`, {
        error: lastError.message,
        attempt,
        willRetry: attempt < maxAttempts,
      });

      // 如果不是最後一次嘗試，等待一段時間再重試
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
      }
    }
  }

  throw new FirestoreRetryError(maxAttempts, lastError);
}

/**
 * 綜合超時和重試的 Firestore 查詢包裝函數
 */
export function withTimeoutAndRetry<T>(
  operation: () => Promise<T>,
  options: {
    timeoutMs?: number;
    maxAttempts?: number;
    delayMs?: number;
  } = {}
): Promise<T> {
  const { timeoutMs = 15000, maxAttempts = 3, delayMs = 1000 } = options;

  return withRetry(() => withTimeout(operation(), timeoutMs), maxAttempts, delayMs);
}
