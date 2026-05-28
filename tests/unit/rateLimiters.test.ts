import express from 'express';
import request from 'supertest';
import { eventViewLimiter } from '../../src/middleware/rateLimiters';

function createEventViewTestApp() {
  const app = express();
  app.set('trust proxy', 1);

  app.post('/events/:id/view', eventViewLimiter, (_req, res) => {
    res.status(204).send();
  });

  return app;
}

describe('eventViewLimiter', () => {
  test('should return 429 after exceeding limit for same IP', async () => {
    const app = createEventViewTestApp();
    const clientIp = '198.51.100.11';

    for (let i = 0; i < 120; i++) {
      const response = await request(app)
        .post('/events/event-1/view')
        .set('x-forwarded-for', clientIp);
      expect(response.status).toBe(204);
    }

    const blockedResponse = await request(app)
      .post('/events/event-1/view')
      .set('x-forwarded-for', clientIp);

    expect(blockedResponse.status).toBe(429);
    expect(blockedResponse.body).toEqual({
      error: 'Too many event view requests, please try again later',
    });
  });

  test('should not block a different IP when one IP exceeded the limit', async () => {
    const app = createEventViewTestApp();
    const blockedIp = '198.51.100.12';
    const allowedIp = '198.51.100.13';

    for (let i = 0; i < 120; i++) {
      const response = await request(app)
        .post('/events/event-2/view')
        .set('x-forwarded-for', blockedIp);
      expect(response.status).toBe(204);
    }

    const blockedResponse = await request(app)
      .post('/events/event-2/view')
      .set('x-forwarded-for', blockedIp);
    expect(blockedResponse.status).toBe(429);

    const allowedResponse = await request(app)
      .post('/events/event-2/view')
      .set('x-forwarded-for', allowedIp);
    expect(allowedResponse.status).toBe(204);
  });
});
