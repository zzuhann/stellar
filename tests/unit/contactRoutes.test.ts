import express from 'express';
import request from 'supertest';

const mockSendContactNotification = jest.fn(() => Promise.resolve());

jest.mock('../../src/services/emailService', () => ({
  ...jest.requireActual('../../src/services/emailService'),
  sendContactNotification: (...args: unknown[]) => mockSendContactNotification(...(args as [])),
}));

// Route validation tests post more than the 5/hour limit; the limiter has its own test below
jest.mock('../../src/middleware/rateLimiters', () => {
  const actual = jest.requireActual('../../src/middleware/rateLimiters');
  const passThrough = (_req: unknown, _res: unknown, next: () => void) => next();
  return { ...Object.fromEntries(Object.keys(actual).map(key => [key, passThrough])), actual };
});

jest.mock('../../src/config/firebase', () => ({
  hasFirebaseConfig: true,
  auth: { verifyIdToken: jest.fn() },
  db: { collection: jest.fn(), getAll: jest.fn() },
}));

import app from '../../src/app';

const validBody = { name: '小明', email: 'fan@example.com', message: '想問場地的事' };

beforeEach(() => {
  mockSendContactNotification.mockClear();
});

describe('POST /api/contact validation', () => {
  it('sends with trimmed values when the body is valid', async () => {
    const res = await request(app)
      .post('/api/contact')
      .send({ name: ' 小明 ', email: ' fan@example.com ', message: ' 想問場地的事 ' });

    expect(res.status).toBe(200);
    expect(mockSendContactNotification).toHaveBeenCalledWith(validBody);
  });

  it.each([
    ['missing name', { ...validBody, name: '' }, 'name'],
    ['blank name', { ...validBody, name: '   ' }, 'name'],
    ['name over 100 chars', { ...validBody, name: 'a'.repeat(101) }, 'name'],
    ['name with a line break', { ...validBody, name: '小明\r\nBcc: x@example.com' }, 'name'],
    ['invalid email', { ...validBody, email: 'not-an-email' }, 'email'],
    ['email with spaces', { ...validBody, email: 'a b@example.com' }, 'email'],
    ['email over 254 chars', { ...validBody, email: `${'a'.repeat(250)}@b.tw` }, 'email'],
    ['missing email', { name: '小明', message: 'hi' }, 'email'],
    ['missing message', { ...validBody, message: '' }, 'message'],
    ['message over 5000 chars', { ...validBody, message: 'a'.repeat(5001) }, 'message'],
  ])('rejects %s with 400 and sends nothing', async (_label, body, field) => {
    const res = await request(app).post('/api/contact').send(body);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR', field });
    expect(mockSendContactNotification).not.toHaveBeenCalled();
  });

  it.each(['a@b.c', '名字@例子.tw'])(
    'accepts %s, which the frontend form also accepts',
    async emailAddress => {
      const res = await request(app)
        .post('/api/contact')
        .send({ ...validBody, email: emailAddress });

      expect(res.status).toBe(200);
    }
  );

  it('accepts values exactly at the limits', async () => {
    const res = await request(app)
      .post('/api/contact')
      .send({ ...validBody, name: 'a'.repeat(100), message: 'a'.repeat(5000) });

    expect(res.status).toBe(200);
  });
});

describe('contactLimiter', () => {
  const { contactLimiter } = jest.requireMock('../../src/middleware/rateLimiters').actual;

  function createApp(status = 200) {
    const limiterApp = express();
    limiterApp.set('trust proxy', 1);
    limiterApp.post('/contact', contactLimiter, (_req, res) => {
      res.status(status).json({});
    });
    return limiterApp;
  }

  it('blocks the 6th submission from the same IP within an hour', async () => {
    const limiterApp = createApp();
    const ip = '198.51.100.21';

    for (let i = 0; i < 5; i++) {
      const res = await request(limiterApp).post('/contact').set('x-forwarded-for', ip);
      expect(res.status).toBe(200);
    }

    const blocked = await request(limiterApp).post('/contact').set('x-forwarded-for', ip);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({
      error: 'Too many contact submissions, please try again later',
      code: 'RATE_LIMITED',
    });

    const otherIp = await request(limiterApp)
      .post('/contact')
      .set('x-forwarded-for', '198.51.100.22');
    expect(otherIp.status).toBe(200);
  });

  it('does not count failed submissions toward the limit', async () => {
    const limiterApp = createApp(400);
    const ip = '198.51.100.23';

    for (let i = 0; i < 6; i++) {
      const res = await request(limiterApp).post('/contact').set('x-forwarded-for', ip);
      expect(res.status).toBe(400);
    }
  });
});
