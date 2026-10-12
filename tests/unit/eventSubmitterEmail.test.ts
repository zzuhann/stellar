import { Response } from 'express';
import { eventSchemas } from '../../src/middleware/validation';
import { EventController } from '../../src/controllers/eventController';
import { AuthenticatedRequest } from '../../src/middleware/auth';
import { EventService } from '../../src/services/eventService';

jest.mock('../../src/services/eventService');

const basePayload = {
  title: '測試活動',
  location: { name: '測試地點', coordinates: { lat: 25.03, lng: 121.56 } },
  datetime: {
    start: { _seconds: 1700000000, _nanoseconds: 0 },
    end: { _seconds: 1700003600, _nanoseconds: 0 },
  },
  artistIds: ['artist-1'],
  socialMedia: { instagram: 'foo' },
};

describe('eventSchemas.create submitterEmail', () => {
  it('keeps a valid submitterEmail after parse (trimmed)', () => {
    const result = eventSchemas.create.safeParse({
      ...basePayload,
      submitterEmail: '  fan@example.com ',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).submitterEmail).toBe('fan@example.com');
    }
  });

  it('passes when submitterEmail is omitted', () => {
    expect(eventSchemas.create.safeParse(basePayload).success).toBe(true);
  });

  it('treats empty string as not provided', () => {
    const result = eventSchemas.create.safeParse({ ...basePayload, submitterEmail: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).submitterEmail).toBeUndefined();
    }
  });

  it('rejects malformed email with path submitterEmail', () => {
    const result = eventSchemas.create.safeParse({
      ...basePayload,
      submitterEmail: 'not-an-email',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['submitterEmail']);
    }
  });

  it('rejects email longer than 254 chars', () => {
    const long = `${'a'.repeat(250)}@example.com`;
    expect(eventSchemas.create.safeParse({ ...basePayload, submitterEmail: long }).success).toBe(
      false
    );
  });
});

describe('EventController.createEvent userEmail precedence', () => {
  let controller: EventController;
  let mockCreateEvent: jest.Mock;
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateEvent = jest.fn().mockResolvedValue({ id: 'e1' });
    (EventService as jest.Mock).mockImplementation(() => ({ createEvent: mockCreateEvent }));
    controller = new EventController();
  });

  const build = (body: object, user?: object) =>
    ({ body, user }) as unknown as AuthenticatedRequest;

  it('anonymous: passes submitterEmail as userEmail and strips it from event data', async () => {
    await controller.createEvent(build({ ...basePayload, submitterEmail: 'fan@example.com' }), res);
    const [data, , email] = mockCreateEvent.mock.calls[0];
    expect(email).toBe('fan@example.com');
    expect(data).not.toHaveProperty('submitterEmail');
  });

  it('logged-in with account email: ignores submitterEmail', async () => {
    await controller.createEvent(
      build(
        { ...basePayload, submitterEmail: 'other@example.com' },
        { uid: 'u1', email: 'acct@example.com', role: 'user' }
      ),
      res
    );
    expect(mockCreateEvent.mock.calls[0][2]).toBe('acct@example.com');
  });
});
