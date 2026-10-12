import { Response } from 'express';
import { artistSchemas } from '../../src/middleware/validation';
import { ArtistController } from '../../src/controllers/artistController';
import { AuthenticatedRequest } from '../../src/middleware/auth';
import { ArtistService } from '../../src/services/artistService';

jest.mock('../../src/services/artistService');

const basePayload = { stageName: '測試藝人' };

describe('artistSchemas.create submitterEmail', () => {
  it('keeps a valid submitterEmail after parse (trimmed)', () => {
    const result = artistSchemas.create.safeParse({
      ...basePayload,
      submitterEmail: '  fan@example.com ',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).submitterEmail).toBe('fan@example.com');
    }
  });

  it('passes when submitterEmail is omitted', () => {
    expect(artistSchemas.create.safeParse(basePayload).success).toBe(true);
  });

  it('treats empty string as not provided', () => {
    const result = artistSchemas.create.safeParse({ ...basePayload, submitterEmail: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).submitterEmail).toBeUndefined();
    }
  });

  it('rejects malformed email with path submitterEmail', () => {
    const result = artistSchemas.create.safeParse({ ...basePayload, submitterEmail: 'nope' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['submitterEmail']);
    }
  });

  it('rejects email longer than 254 chars', () => {
    const long = `${'a'.repeat(250)}@example.com`;
    expect(artistSchemas.create.safeParse({ ...basePayload, submitterEmail: long }).success).toBe(
      false
    );
  });
});

describe('ArtistController.createArtist userEmail precedence', () => {
  let controller: ArtistController;
  let mockCreateArtist: jest.Mock;
  const statusMock = jest.fn().mockReturnThis();
  const jsonMock = jest.fn();
  const res = { status: statusMock, json: jsonMock } as unknown as Response;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateArtist = jest.fn().mockResolvedValue({ id: 'a1', stageName: 'x' });
    (ArtistService as jest.Mock).mockImplementation(() => ({ createArtist: mockCreateArtist }));
    controller = new ArtistController();
  });

  const build = (body: object, user: object) => ({ body, user }) as unknown as AuthenticatedRequest;

  it('anonymous Firebase user (email ""): falls back to submitterEmail', async () => {
    await controller.createArtist(
      build(
        { ...basePayload, submitterEmail: 'fan@example.com' },
        { uid: 'anon1', email: '', role: 'user' }
      ),
      res
    );
    const [data, , email] = mockCreateArtist.mock.calls[0];
    expect(email).toBe('fan@example.com');
    expect(data).not.toHaveProperty('submitterEmail');
  });

  it('account email wins over submitterEmail', async () => {
    await controller.createArtist(
      build(
        { ...basePayload, submitterEmail: 'other@example.com' },
        { uid: 'u1', email: 'acct@example.com', role: 'user' }
      ),
      res
    );
    expect(mockCreateArtist.mock.calls[0][2]).toBe('acct@example.com');
  });

  it('201 response omits createdByEmail but keeps other fields', async () => {
    mockCreateArtist.mockResolvedValue({ id: 'a1', stageName: 'x', createdByEmail: 'f@e.com' });
    await controller.createArtist(build(basePayload, { uid: 'u1', email: '', role: 'user' }), res);
    expect(statusMock).toHaveBeenCalledWith(201);
    expect(jsonMock).toHaveBeenCalledWith({ id: 'a1', stageName: 'x' });
  });
});
