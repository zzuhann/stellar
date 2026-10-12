jest.mock('@sentry/node', () => ({
  ...jest.requireActual('@sentry/node'),
  captureException: jest.fn(),
}));

import app from '../../src/app';
import { AppError } from '../../src/utils/AppError';

type ErrorHandler = (err: Error, req: unknown, res: unknown, next: () => void) => void;

// app.ts 的全域 handler 沒 export，從 router stack 取最後一個 4 參數 middleware
function getGlobalErrorHandler(): ErrorHandler {
  const stack = (app as unknown as { router: { stack: Array<{ handle: ErrorHandler }> } }).router
    .stack;
  const handlers = stack.map(layer => layer.handle).filter(fn => fn.length === 4);
  return handlers[handlers.length - 1];
}

function run(err: Error) {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    header: jest.fn(),
  };
  const req = { method: 'GET', path: '/x', headers: {} };
  getGlobalErrorHandler()(err, req, res, jest.fn());
  return res;
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('全域 error handler 與 AppError.details', () => {
  it('R8 沒帶 details：輸出欄位與改動前逐一相同，不多出 details key', () => {
    const res = run(new AppError(404, 'NOT_FOUND', 'missing'));

    expect(res.statusCode).toBe(404);
    expect(res.body).toStrictEqual({ error: 'missing', code: 'NOT_FOUND' });
  });

  it('R8 帶 field 沒帶 details：field 照舊輸出', () => {
    const res = run(new AppError(400, 'VALIDATION_ERROR', 'bad', 'name'));

    expect(res.body).toStrictEqual({ error: 'bad', code: 'VALIDATION_ERROR', field: 'name' });
  });

  it('R9 帶 details：多輸出 details，其他欄位不變', () => {
    const res = run(
      new AppError(409, 'PLACE_ID_IN_USE', 'in use', undefined, { venue: { id: 'v' } })
    );

    expect(res.statusCode).toBe(409);
    expect(res.body).toStrictEqual({
      error: 'in use',
      code: 'PLACE_ID_IN_USE',
      details: { venue: { id: 'v' } },
    });
  });

  it('R9 field 與 details 並存', () => {
    const res = run(new AppError(422, 'X', 'msg', 'f', { n: 1 }));

    expect(res.body).toStrictEqual({ error: 'msg', code: 'X', field: 'f', details: { n: 1 } });
  });

  it.each([
    [400, 'VALIDATION_ERROR'],
    [404, 'EVENT_NOT_FOUND'],
    [500, 'SOME_SERVER_ERROR'],
  ])('R10 AppError %i 輸出形狀不變', (status, code) => {
    const res = run(new AppError(status, code, 'msg'));

    expect(res.statusCode).toBe(status);
    expect(res.body).toStrictEqual({ error: 'msg', code });
  });

  it('R10 非 AppError 的未預期錯誤：500 INTERNAL_ERROR 形狀不變', () => {
    const res = run(new Error('boom'));

    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({
      error: 'Internal server error',
      message: 'boom',
      code: 'INTERNAL_ERROR',
    });
    expect(res.body).not.toHaveProperty('details');
  });
});
