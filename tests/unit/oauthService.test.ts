import { encodeState, decodeState } from '../../src/services/oauthService';

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv, OAUTH_STATE_SECRET: 'test-secret-at-least-32-chars-long!!' };
});

afterEach(() => {
  process.env = originalEnv;
});

describe('encodeState / decodeState', () => {
  const validData = {
    eventId: 'event-123',
    userId: 'user-456',
    redirectUrl: 'https://example.com/callback',
  };

  it('encodes and decodes state correctly', () => {
    const state = encodeState(validData);
    const decoded = decodeState(state);

    expect(decoded.eventId).toBe(validData.eventId);
    expect(decoded.userId).toBe(validData.userId);
    expect(decoded.redirectUrl).toBe(validData.redirectUrl);
    expect(typeof decoded.timestamp).toBe('number');
  });

  it('rejects tampered payload', () => {
    const state = encodeState(validData);
    const [encoded, sig] = state.split('.');

    // tamper: change eventId in payload
    const tampered = JSON.parse(Buffer.from(encoded, 'base64url').toString());
    tampered.eventId = 'evil-event';
    const tamperedEncoded = Buffer.from(JSON.stringify(tampered)).toString('base64url');

    expect(() => decodeState(`${tamperedEncoded}.${sig}`)).toThrow('Invalid state signature');
  });

  it('rejects forged state with no signature', () => {
    const forged = Buffer.from(JSON.stringify({ ...validData, timestamp: Date.now() })).toString('base64url');
    expect(() => decodeState(forged)).toThrow('Invalid state format');
  });

  it('rejects expired state', () => {
    jest.useFakeTimers();
    const state = encodeState(validData);

    // advance 11 minutes
    jest.advanceTimersByTime(11 * 60 * 1000);

    expect(() => decodeState(state)).toThrow('State expired');
    jest.useRealTimers();
  });

  it('throws when OAUTH_STATE_SECRET is missing', () => {
    delete process.env.OAUTH_STATE_SECRET;
    expect(() => encodeState(validData)).toThrow('OAUTH_STATE_SECRET environment variable is required');
  });

  it('rejects state signed with a different secret', () => {
    const state = encodeState(validData);

    // switch to a different secret
    process.env.OAUTH_STATE_SECRET = 'different-secret-at-least-32-chars!!';

    expect(() => decodeState(state)).toThrow('Invalid state signature');
  });
});
