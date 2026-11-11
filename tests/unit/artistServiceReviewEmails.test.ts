import { ArtistService } from '../../src/services/artistService';

const mockSend = jest.fn();
const mockIsAnonymousUser = jest.fn();
const mockBatchUpdate = jest.fn();
const mockBatchCommit = jest.fn();
const docs: Record<string, { get: jest.Mock; update: jest.Mock }> = {};

jest.mock('resend', () => ({ Resend: jest.fn(() => ({ emails: { send: mockSend } })) }));

jest.mock('../../src/config/firebase', () => ({
  hasFirebaseConfig: true,
  db: { collection: jest.fn(), batch: jest.fn() },
}));

jest.mock('../../src/utils/firestoreTimeout', () => ({
  withTimeoutAndRetry: jest.fn((fn: () => unknown) => fn()),
}));

jest.mock('../../src/services/userService', () => ({
  UserService: jest.fn().mockImplementation(() => ({
    isAnonymousUser: (...args: unknown[]) => mockIsAnonymousUser(...args),
    getUserById: jest.fn().mockResolvedValue({ displayName: 'Fan' }),
  })),
}));

jest.mock('../../src/services/emailService', () => {
  process.env.RESEND_API_KEY = 'test-key';
  return {
    sendArtistApprovalEmails: jest.fn().mockResolvedValue(undefined),
    sendArtistSubmissionNotification: jest.fn().mockResolvedValue(undefined),
    sendArtistRejectionEmails: jest.fn().mockResolvedValue(undefined),
    sendArtistExistsEmails: jest.fn().mockResolvedValue(undefined),
  };
});

const email = jest.requireMock('../../src/services/emailService') as Record<string, jest.Mock>;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

const addDoc = (id: string, data: Record<string, unknown> | null) => {
  docs[id] = {
    get: jest
      .fn()
      .mockResolvedValue(
        data === null ? { exists: false, id } : { exists: true, id, data: () => data }
      ),
    update: jest.fn().mockResolvedValue(undefined),
  };
};

const fan = (stageName: string, extra: Record<string, unknown> = {}) => ({
  status: 'pending',
  stageName,
  createdBy: 'uid-1',
  createdByEmail: 'fan@example.com',
  ...extra,
});

describe('ArtistService review result emails', () => {
  let service: ArtistService;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(docs)) delete docs[key];
    mockIsAnonymousUser.mockReset().mockResolvedValue(false);
    mockSend.mockReset().mockResolvedValue({ data: { id: 'x' }, error: null });
    mockBatchCommit.mockReset().mockResolvedValue(undefined);
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const firebase = jest.requireMock('../../src/config/firebase');
    (firebase.db.collection as jest.Mock).mockReturnValue({ doc: (id: string) => docs[id] });
    (firebase.db.batch as jest.Mock).mockReturnValue({
      update: mockBatchUpdate,
      commit: mockBatchCommit,
    });
    service = new ArtistService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('TC-R03 single rejection', () => {
    it('sends the rejection email after the status write, and nothing else', async () => {
      addDoc('a1', fan('Karina'));

      await service.updateArtistStatus('a1', 'rejected', '照片不清楚');

      expect(email.sendArtistRejectionEmails).toHaveBeenCalledTimes(1);
      expect(email.sendArtistRejectionEmails.mock.calls[0][0]).toEqual([
        expect.objectContaining({
          createdByEmail: 'fan@example.com',
          createdBy: 'uid-1',
          stageName: 'Karina',
          reason: '照片不清楚',
        }),
      ]);
      expect(email.sendArtistApprovalEmails).not.toHaveBeenCalled();
      expect(email.sendArtistExistsEmails).not.toHaveBeenCalled();
      expect(docs.a1.update.mock.invocationCallOrder[0]).toBeLessThan(
        email.sendArtistRejectionEmails.mock.invocationCallOrder[0]
      );
    });
  });

  describe('TC-E02 single exists', () => {
    it('stores exists with rejectedReason null and sends the exists email only', async () => {
      addDoc('a1', fan('Karina'));

      await service.updateArtistStatus('a1', 'exists', '藝人已存在');

      expect(docs.a1.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'exists', rejectedReason: null })
      );
      expect(email.sendArtistExistsEmails).toHaveBeenCalledTimes(1);
      const [rows] = email.sendArtistExistsEmails.mock.calls[0];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ createdByEmail: 'fan@example.com', stageName: 'Karina' });
      expect(rows[0]).not.toHaveProperty('reason');
      expect(email.sendArtistRejectionEmails).not.toHaveBeenCalled();
    });
  });

  describe('TC-R04 batch rejection pairs reasons by id', () => {
    it('keeps each reason with its own artist even when reads resolve out of order', async () => {
      const names: Record<string, string> = { a1: 'Karina', a2: 'Winter', a3: 'Ningning' };
      const delays: Record<string, number> = { a1: 15, a2: 5, a3: 0 };
      for (const id of Object.keys(names)) {
        addDoc(id, fan(names[id]));
        docs[id].get.mockImplementation(
          () =>
            new Promise(resolve =>
              setTimeout(
                () => resolve({ exists: true, id, data: () => fan(names[id]) }),
                delays[id]
              )
            )
        );
      }

      await service.batchUpdateArtistStatus([
        { artistId: 'a1', status: 'rejected', reason: '原因1' },
        { artistId: 'a2', status: 'approved' },
        { artistId: 'a3', status: 'rejected', reason: '原因3' },
      ]);

      const [rejected] = email.sendArtistRejectionEmails.mock.calls[0];
      expect(
        rejected.map((r: { stageName: string; reason: string }) => [r.stageName, r.reason])
      ).toEqual([
        ['Karina', '原因1'],
        ['Ningning', '原因3'],
      ]);
      const [approved] = email.sendArtistApprovalEmails.mock.calls[0];
      expect(approved.map((a: { stageName: string }) => a.stageName)).toEqual(['Winter']);
    });
  });

  describe('TC-E03 batch exists', () => {
    it('sends exists emails for both, no rejection or approval mail', async () => {
      addDoc('a1', fan('Karina'));
      addDoc('a2', fan('Winter'));

      await service.batchUpdateArtistStatus([
        { artistId: 'a1', status: 'exists' },
        { artistId: 'a2', status: 'exists' },
      ]);

      const [rows] = email.sendArtistExistsEmails.mock.calls[0];
      expect(rows.map((r: { stageName: string }) => r.stageName)).toEqual(['Karina', 'Winter']);
      expect(email.sendArtistRejectionEmails).not.toHaveBeenCalled();
      expect(email.sendArtistApprovalEmails).not.toHaveBeenCalled();
    });
  });

  describe('TC-M02 mixed batch', () => {
    it('routes each status to its own mail function without mixing', async () => {
      for (const [id, name] of [
        ['a1', 'A1'],
        ['a2', 'A2'],
        ['a3', 'A3'],
        ['a4', 'A4'],
      ]) {
        addDoc(id, fan(name));
      }

      await service.batchUpdateArtistStatus([
        { artistId: 'a1', status: 'approved' },
        { artistId: 'a2', status: 'rejected', reason: 'r2' },
        { artistId: 'a3', status: 'rejected', reason: 'r3' },
        { artistId: 'a4', status: 'exists' },
      ]);

      const names = (fn: string) =>
        email[fn].mock.calls[0][0].map((r: { stageName: string }) => r.stageName);
      expect(names('sendArtistApprovalEmails')).toEqual(['A1']);
      expect(names('sendArtistRejectionEmails')).toEqual(['A2', 'A3']);
      expect(names('sendArtistExistsEmails')).toEqual(['A4']);
    });
  });

  describe('TC-A04 isAnonymousUser injection', () => {
    it('passes userService.isAnonymousUser to the rejection mail, not to the exists mail', async () => {
      addDoc('a1', fan('Karina'));
      mockIsAnonymousUser.mockResolvedValue(true);

      await service.updateArtistStatus('a1', 'rejected', 'r');
      const isAnon = email.sendArtistRejectionEmails.mock.calls[0][1];
      await expect(isAnon('uid-1')).resolves.toBe(true);
      expect(mockIsAnonymousUser).toHaveBeenCalledWith('uid-1');

      mockIsAnonymousUser.mockClear();
      await service.updateArtistStatus('a1', 'exists');
      expect(mockIsAnonymousUser).not.toHaveBeenCalled();
    });
  });

  describe('TC-S04 missing createdByEmail', () => {
    it('does not send a rejection mail for a doc without createdByEmail', async () => {
      addDoc('a1', { status: 'pending', stageName: 'Karina', createdBy: 'uid-1' });

      await expect(service.updateArtistStatus('a1', 'rejected', 'r')).resolves.toBeDefined();

      expect(email.sendArtistRejectionEmails).not.toHaveBeenCalled();
    });
  });

  describe('TC-S05 write failure', () => {
    it('sends nothing when the single status write fails', async () => {
      addDoc('a1', fan('Karina'));
      docs.a1.update.mockRejectedValue(new Error('write failed'));

      await expect(service.updateArtistStatus('a1', 'rejected', 'r')).rejects.toThrow(
        'write failed'
      );

      expect(email.sendArtistRejectionEmails).not.toHaveBeenCalled();
    });

    it('sends nothing when the batch commit fails', async () => {
      addDoc('a1', fan('Karina'));
      mockBatchCommit.mockRejectedValue(new Error('commit failed'));

      await expect(
        service.batchUpdateArtistStatus([{ artistId: 'a1', status: 'rejected', reason: 'r' }])
      ).rejects.toThrow('commit failed');

      expect(email.sendArtistRejectionEmails).not.toHaveBeenCalled();
      expect(email.sendArtistExistsEmails).not.toHaveBeenCalled();
    });
  });

  describe('TC-S06 fire-and-forget', () => {
    it('does not wait for the mail, and a later mail failure only logs', async () => {
      addDoc('a1', fan('Karina'));
      let reject!: (err: Error) => void;
      email.sendArtistRejectionEmails.mockReturnValue(
        new Promise<void>((_res, rej) => {
          reject = rej;
        })
      );

      const result = await service.updateArtistStatus('a1', 'rejected', 'r');
      expect(result).toMatchObject({ id: 'a1', status: 'rejected' });

      reject(new Error('boom'));
      await flush();

      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('does not wait for the anonymity lookup; the mail goes out once it settles', async () => {
      const actual = jest.requireActual('../../src/services/emailService');
      email.sendArtistRejectionEmails.mockImplementation(actual.sendArtistRejectionEmails);
      addDoc('a1', fan('Karina'));
      let release!: (isAnonymous: boolean) => void;
      mockIsAnonymousUser.mockReturnValue(
        new Promise<boolean>(resolve => {
          release = resolve;
        })
      );

      await service.updateArtistStatus('a1', 'rejected', 'r');
      await flush();
      expect(mockSend).not.toHaveBeenCalled();

      release(false);
      await flush();

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend.mock.calls[0][0].html).toContain('my-submissions');
    });
  });
});
