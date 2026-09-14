export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly field?: string
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  const message = error instanceof Error ? error.message : '';
  if (/活動不存在|Event not found/.test(message)) {
    return new AppError(404, 'EVENT_NOT_FOUND', 'Event not found');
  }
  if (/藝人不存在|Artist not found/.test(message)) {
    return new AppError(404, 'ARTIST_NOT_FOUND', 'Artist not found');
  }
  if (/場地不存在|Venue not found/.test(message)) {
    return new AppError(404, 'VENUE_NOT_FOUND', 'Venue not found');
  }
  if (/權限不足|Permission denied/.test(message)) {
    return new AppError(403, 'FORBIDDEN', 'Permission denied');
  }
  if (/Firebase 問題|R2 問題|service unavailable/i.test(message)) {
    return new AppError(503, 'SERVICE_UNAVAILABLE', 'Service unavailable');
  }

  return new AppError(500, 'INTERNAL_ERROR', 'Internal server error');
}
