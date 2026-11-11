import { EventService } from '../../src/services/eventService';

const mockSend = jest.fn();
const mockIsAnonymousUser = jest.fn();
const mockBatchUpdate = jest.fn();
const mockBatchCommit = jest.fn();
const mockSyncEventVenue = jest.fn();
const docs: Record<string, { get: jest.Mock; update: jest.Mock }> = {};

jest.mock('resend', () => ({ Resend: jest.fn(() => ({ emails: { send: mockSend } })) }));

jest.mock('../../src/config/firebase', () => ({
  hasFirebaseConfig: true,
  db: { collection: jest.fn(), batch: jest.fn(), runTransaction: jest.fn() },
}));

jest.mock('../../src/utils/firestoreTimeout', () => ({
  withTimeoutAndRetry: jest.fn((fn: () => unknown) => fn()),
}));

jest.mock('../../src/services/eventVenueSync', () => ({
  syncEventVenue: (...args: unknown[]) => mockSyncEventVenue(...args),
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
    sendEventApprovalEmails: jest.fn().mockResolvedValue(undefined),
    sendEventSubmissionNotification: jest.fn().mockResolvedValue(undefined),
    sendEventRejectionEmails: jest.fn().mockResolvedValue(undefined),
  };
});

const email = jest.requireMock('../../src/services/emailService') as Record<string, jest.Mock>;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

const addDoc = (id: string, data: Record<string, unknown>) => {
  docs[id] = {
    get: jest.fn().mockResolvedValue({ exists: true, id, data: () => data }),
    update: jest.fn().mockResolvedValue(undefined),
  };
};

const fanEvent = (title: string, extra: Record<string, unknown> = {}) => ({
  status: 'pending',
  title,
  createdBy: 'uid-1',
  createdByEmail: 'fan@example.com',
  ...extra,
});

describe('EventService review result emails', () => {
  let service: EventService;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(docs)) delete docs[key];
    mockIsAnonymousUser.mockReset().mockResolvedValue(false);
    mockSend.mockReset().mockResolvedValue({ data: { id: 'x' }, error: null });
    mockBatchCommit.mockReset().mockResolvedValue(undefined);
    mockSyncEventVenue.mockReset().mockResolvedValue(undefined);
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const firebase = jest.requireMock('../../src/config/firebase');
    (firebase.db.collection as jest.Mock).mockReturnValue({ doc: (id: string) => docs[id] });
    (firebase.db.batch as jest.Mock).mockReturnValue({
      update: mockBatchUpdate,
      commit: mockBatchCommit,
    });
    service = new EventService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('TC-R03 single rejection', () => {
    it('sends the rejection email after the status write, and no approval mail', async () => {
      addDoc('e1', fanEvent('生咖甲'));

      await service.updateEventStatus('e1', 'rejected', '日期錯誤');

      expect(email.sendEventRejectionEmails).toHaveBeenCalledTimes(1);
      expect(email.sendEventRejectionEmails.mock.calls[0][0]).toEqual([
        expect.objectContaining({
          createdByEmail: 'fan@example.com',
          createdBy: 'uid-1',
          title: '生咖甲',
          reason: '日期錯誤',
        }),
      ]);
      expect(email.sendEventApprovalEmails).not.toHaveBeenCalled();
      expect(docs.e1.update.mock.invocationCallOrder[0]).toBeLessThan(
        email.sendEventRejectionEmails.mock.invocationCallOrder[0]
      );
    });
  });

  describe('TC-R04 batch rejection pairs reasons by id', () => {
    it('keeps each reason with its own event even when reads resolve out of order', async () => {
      const titles: Record<string, string> = { e1: '活動甲', e2: '活動乙', e3: '活動丙' };
      const delays: Record<string, number> = { e1: 15, e2: 5, e3: 0 };
      for (const id of Object.keys(titles)) {
        addDoc(id, fanEvent(titles[id]));
        docs[id].get.mockImplementation(
          () =>
            new Promise(resolve =>
              setTimeout(
                () => resolve({ exists: true, id, data: () => fanEvent(titles[id]) }),
                delays[id]
              )
            )
        );
      }

      await service.batchUpdateEventStatus([
        { eventId: 'e1', status: 'rejected', reason: '原因1' },
        { eventId: 'e2', status: 'approved' },
        { eventId: 'e3', status: 'rejected', reason: '原因3' },
      ]);

      const [rejected] = email.sendEventRejectionEmails.mock.calls[0];
      expect(rejected.map((r: { title: string; reason: string }) => [r.title, r.reason])).toEqual([
        ['活動甲', '原因1'],
        ['活動丙', '原因3'],
      ]);
      const [approved] = email.sendEventApprovalEmails.mock.calls[0];
      expect(approved.map((e: { title: string }) => e.title)).toEqual(['活動乙']);
    });
  });

  describe('TC-A04 isAnonymousUser injection', () => {
    it('passes userService.isAnonymousUser to the rejection mail', async () => {
      addDoc('e1', fanEvent('生咖甲'));
      mockIsAnonymousUser.mockResolvedValue(true);

      await service.updateEventStatus('e1', 'rejected', 'r');
      const isAnon = email.sendEventRejectionEmails.mock.calls[0][1];

      await expect(isAnon('uid-1')).resolves.toBe(true);
      expect(mockIsAnonymousUser).toHaveBeenCalledWith('uid-1');
    });
  });

  describe('TC-S04 missing createdByEmail', () => {
    it('does not send a rejection mail for a doc without createdByEmail', async () => {
      addDoc('e1', { status: 'pending', title: '生咖甲', createdBy: 'uid-1' });

      await expect(service.updateEventStatus('e1', 'rejected', 'r')).resolves.toBeDefined();

      expect(email.sendEventRejectionEmails).not.toHaveBeenCalled();
    });
  });

  describe('TC-S05 write failure', () => {
    it('sends nothing when the single status write fails', async () => {
      addDoc('e1', fanEvent('生咖甲'));
      docs.e1.update.mockRejectedValue(new Error('write failed'));

      await expect(service.updateEventStatus('e1', 'rejected', 'r')).rejects.toThrow(
        'write failed'
      );

      expect(email.sendEventRejectionEmails).not.toHaveBeenCalled();
    });

    it('sends nothing when the batch commit fails', async () => {
      addDoc('e1', fanEvent('生咖甲'));
      mockBatchCommit.mockRejectedValue(new Error('commit failed'));

      await expect(
        service.batchUpdateEventStatus([{ eventId: 'e1', status: 'rejected', reason: 'r' }])
      ).rejects.toThrow('commit failed');

      expect(email.sendEventRejectionEmails).not.toHaveBeenCalled();
    });
  });

  describe('TC-S06 fire-and-forget', () => {
    it.each([
      ['single', (s: EventService) => s.updateEventStatus('e1', 'rejected', 'r')],
      [
        'batch',
        (s: EventService) =>
          s.batchUpdateEventStatus([{ eventId: 'e1', status: 'rejected', reason: 'r' }]),
      ],
    ])('%s: does not wait for the mail, and a later mail failure only logs', async (_n, run) => {
      addDoc('e1', fanEvent('生咖甲'));
      let reject!: (err: Error) => void;
      email.sendEventRejectionEmails.mockReturnValue(
        new Promise<void>((_res, rej) => {
          reject = rej;
        })
      );

      await expect(run(service)).resolves.toBeDefined();

      reject(new Error('boom'));
      await flush();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it.each([
      ['single', (s: EventService) => s.updateEventStatus('e1', 'rejected', 'r')],
      [
        'batch',
        (s: EventService) =>
          s.batchUpdateEventStatus([{ eventId: 'e1', status: 'rejected', reason: 'r' }]),
      ],
    ])(
      '%s: does not wait for the anonymity lookup; the mail goes out once it settles',
      async (_n, run) => {
        const actual = jest.requireActual('../../src/services/emailService');
        email.sendEventRejectionEmails.mockImplementation(actual.sendEventRejectionEmails);
        addDoc('e1', fanEvent('生咖甲'));
        let release!: (isAnonymous: boolean) => void;
        mockIsAnonymousUser.mockReturnValue(
          new Promise<boolean>(resolve => {
            release = resolve;
          })
        );

        await run(service);
        await flush();
        expect(mockSend).not.toHaveBeenCalled();

        release(false);
        await flush();

        expect(mockSend).toHaveBeenCalledTimes(1);
        expect(mockSend.mock.calls[0][0].html).toContain('my-submissions');
      }
    );
  });

  describe('TC-S07 single: updatedDoc re-read fails after the write', () => {
    it('still starts the rejection mail', async () => {
      addDoc('e1', fanEvent('生咖甲'));
      docs.e1.get
        .mockResolvedValueOnce({ exists: true, id: 'e1', data: () => fanEvent('生咖甲') })
        .mockRejectedValueOnce(new Error('re-read failed'));

      await expect(service.updateEventStatus('e1', 'rejected', 'r')).rejects.toThrow(
        're-read failed'
      );

      expect(docs.e1.update).toHaveBeenCalled();
      expect(email.sendEventRejectionEmails).toHaveBeenCalledTimes(1);
      expect(email.sendEventRejectionEmails.mock.calls[0][0]).toEqual([
        expect.objectContaining({ title: '生咖甲', reason: 'r' }),
      ]);
    });
  });

  describe('TC-S08 mixed batch: venue sync of an approved item throws', () => {
    it('still sends the rejection mail for the committed rejected item', async () => {
      addDoc('e1', fanEvent('活動甲', { location: { placeId: 'place-1' } }));
      addDoc('e2', fanEvent('活動乙'));
      mockSyncEventVenue.mockRejectedValue(new Error('venue sync failed'));

      await expect(
        service.batchUpdateEventStatus([
          { eventId: 'e1', status: 'approved' },
          { eventId: 'e2', status: 'rejected', reason: '原因2' },
        ])
      ).rejects.toThrow('venue sync failed');

      expect(mockBatchCommit).toHaveBeenCalled();
      expect(email.sendEventRejectionEmails).toHaveBeenCalledTimes(1);
      expect(email.sendEventRejectionEmails.mock.calls[0][0]).toEqual([
        expect.objectContaining({ title: '活動乙', reason: '原因2' }),
      ]);
    });
  });
});
