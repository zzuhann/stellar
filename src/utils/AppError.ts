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

  return new AppError(500, 'INTERNAL_ERROR', 'Internal server error');
}
