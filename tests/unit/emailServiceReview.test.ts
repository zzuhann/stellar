type Email = typeof import('../../src/services/emailService');
type Row = [email: string, uid: string, name: string, reason: string];
type IsAnon = (uid: string) => Promise<boolean>;

const send = jest.fn();
const originalEnv = { ...process.env };
const payload = `<a href="https://evil.example">驗證帳號</a>`;
const MY_SUBMISSIONS = 'https://www.stellar-zone.com/my-submissions';

const loadEmailService = () => import('../../src/services/emailService');
const sent = (index = 0) =>
  send.mock.calls[index][0] as { to: string; subject: string; html: string; from: string };
const notAnon: IsAnon = () => Promise.resolve(false);
const anon: IsAnon = () => Promise.resolve(true);
const resendError = { data: null, error: { name: 'application_error', message: 'x' } };

// Artist and event rejection mails share a shape; only the noun and the name key differ
const rejectionSingles = [
  ['artist', '藝人', (e: Email) => e.sendArtistRejectionEmail],
  ['event', '活動', (e: Email) => e.sendEventRejectionEmail],
] as const;

const rejectionBatches = [
  [
    'artist',
    '藝人',
    (e: Email) => (rows: Row[], isAnon: IsAnon) =>
      e.sendArtistRejectionEmails(
        rows.map(([createdByEmail, createdBy, stageName, reason]) => ({
          createdByEmail: createdByEmail || undefined,
          createdBy,
          stageName,
          reason,
        })),
        isAnon
      ),
  ],
  [
    'event',
    '活動',
    (e: Email) => (rows: Row[], isAnon: IsAnon) =>
      e.sendEventRejectionEmails(
        rows.map(([createdByEmail, createdBy, title, reason]) => ({
          createdByEmail: createdByEmail || undefined,
          createdBy,
          title,
          reason,
        })),
        isAnon
      ),
  ],
] as const;

beforeEach(() => {
  jest.resetModules();
  send.mockReset().mockResolvedValue({ data: { id: 'x' }, error: null });
  jest.doMock('resend', () => ({ Resend: jest.fn(() => ({ emails: { send } })) }));
  jest.doMock('@sentry/node', () => ({ captureException: jest.fn() }));
  process.env.RESEND_API_KEY = 'test-key';
  delete process.env.EMAIL_WHITELIST;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...originalEnv };
  jest.dontMock('resend');
  jest.dontMock('@sentry/node');
  jest.restoreAllMocks();
});

describe('TC-R01 single rejection subject and body', () => {
  it.each(rejectionSingles)('%s', async (_kind, label, pick) => {
    const email = await loadEmailService();

    await pick(email)({
      email: 'fan@example.com',
      items: [{ name: 'Karina', reason: '照片不清楚' }],
      showMySubmissions: true,
    });

    expect(send).toHaveBeenCalledTimes(1);
    const mail = sent();
    expect(mail.to).toBe('fan@example.com');
    expect(mail.from).toBe('STELLAR <noreply@stellar-zone.com>');
    expect(mail.subject).toBe(`[STELLAR] 你投稿的${label}「Karina」沒有通過審核`);
    expect(mail.html).toContain('你好～');
    expect(mail.html).not.toContain('親愛的用戶');
    expect(mail.html).toContain('Karina');
    expect(mail.html).toContain('照片不清楚');
    expect(mail.html).toContain(MY_SUBMISSIONS);
    expect(mail.html).toContain('STELLAR 生咖地圖平台團隊');
  });
});

describe('TC-R02 escaping', () => {
  it.each(rejectionSingles)('%s rejection escapes name and reason', async (_kind, _label, pick) => {
    const email = await loadEmailService();

    await pick(email)({
      email: 'fan@example.com',
      items: [{ name: payload, reason: payload }],
      showMySubmissions: true,
    });

    const { html } = sent();
    expect(html).not.toContain(payload);
    expect(html).toContain(email.escapeHtml(payload));
  });

  it('exists email escapes names', async () => {
    const email = await loadEmailService();

    await email.sendArtistExistsEmail({ email: 'fan@example.com', names: [payload] });

    const { html } = sent();
    expect(html).not.toContain(payload);
    expect(html).toContain(email.escapeHtml(payload));
  });

  it.each(rejectionSingles)(
    '%s rejection keeps reason line breaks via pre-wrap',
    async (_kind, _label, pick) => {
      const email = await loadEmailService();

      await pick(email)({
        email: 'fan@example.com',
        items: [{ name: 'Karina', reason: '第一行\n第二行' }],
        showMySubmissions: true,
      });

      expect(sent().html).toContain('<span style="white-space: pre-wrap">第一行\n第二行</span>');
    }
  );

  it('does not escape the subject', async () => {
    const email = await loadEmailService();

    await email.sendArtistRejectionEmail({
      email: 'fan@example.com',
      items: [{ name: 'A&B', reason: 'r' }],
      showMySubmissions: true,
    });

    expect(sent().subject).toBe('[STELLAR] 你投稿的藝人「A&B」沒有通過審核');
  });
});

describe('TC-E01 exists email', () => {
  it('single and multiple names', async () => {
    const email = await loadEmailService();

    await email.sendArtistExistsEmail({ email: 'fan@example.com', names: ['Karina'] });
    await email.sendArtistExistsEmail({ email: 'fan@example.com', names: ['Karina', 'Winter'] });

    expect(sent(0).subject).toBe('[STELLAR] 你投稿的藝人「Karina」已經在平台上囉');
    expect(sent(1).subject).toBe('[STELLAR] 你投稿的藝人已經在平台上囉');
    expect(sent(1).html).toContain('Karina、Winter');
    for (const i of [0, 1]) {
      const { html } = sent(i);
      expect(html).toContain('https://www.stellar-zone.com');
      expect(html).toContain('STELLAR 生咖地圖平台團隊');
      expect(html).not.toContain('藝人已存在');
      expect(html).not.toContain('my-submissions');
      expect(html).not.toContain('原因');
    }
  });

  it('sendArtistExistsEmails groups the same email into one mail', async () => {
    const email = await loadEmailService();

    await email.sendArtistExistsEmails([
      { createdByEmail: 'a@x.com', stageName: 'Karina' },
      { createdByEmail: 'b@x.com', stageName: 'Ningning' },
      { createdByEmail: 'a@x.com', stageName: 'Winter' },
      { stageName: 'NoEmail' },
    ]);

    expect(send).toHaveBeenCalledTimes(2);
    expect(sent(0).to).toBe('a@x.com');
    expect(sent(0).html).toContain('Karina、Winter');
    expect(sent(1).subject).toBe('[STELLAR] 你投稿的藝人「Ningning」已經在平台上囉');
  });
});

describe('TC-M01 batch merging', () => {
  it.each(rejectionBatches)(
    '%s: same submitter merges into one mail with per-line reasons',
    async (_kind, label, pick) => {
      const email = await loadEmailService();

      await pick(email)(
        [
          ['a@x.com', 'u1', '甲', 'r1'],
          ['b@x.com', 'u2', '丙', 'r3'],
          ['a@x.com', 'u1', '乙', 'r2'],
        ],
        notAnon
      );

      expect(send).toHaveBeenCalledTimes(2);
      const merged = sent(0);
      expect(merged.to).toBe('a@x.com');
      expect(merged.subject).toBe(`[STELLAR] 你投稿的${label}沒有通過審核`);
      expect(merged.html).toContain('甲、乙');
      expect(merged.html).toContain('甲：r1');
      expect(merged.html).toContain('乙：r2');
      expect(merged.html.indexOf('甲：r1')).toBeLessThan(merged.html.indexOf('乙：r2'));
      const single = sent(1);
      expect(single.to).toBe('b@x.com');
      expect(single.subject).toBe(`[STELLAR] 你投稿的${label}「丙」沒有通過審核`);
    }
  );

  it.each(rejectionBatches)(
    '%s: a reason shared by every merged item is written once, without names',
    async (_kind, _label, pick) => {
      const email = await loadEmailService();

      await pick(email)(
        [
          ['a@x.com', 'u1', '甲', '照片不清楚\n請換一張'],
          ['a@x.com', 'u1', '乙', '照片不清楚\n請換一張'],
        ],
        notAnon
      );

      const { html } = sent(0);
      expect(html.split('照片不清楚').length - 1).toBe(1);
      expect(html).not.toContain('甲：');
      expect(html).toContain('甲、乙');
    }
  );
});

describe('TC-A02 anonymous recipients get no my-submissions line', () => {
  it.each(rejectionSingles)(
    '%s single with showMySubmissions=false',
    async (_kind, _label, pick) => {
      const email = await loadEmailService();

      await pick(email)({
        email: 'fan@example.com',
        items: [{ name: 'Karina', reason: '原因甲' }],
        showMySubmissions: false,
      });

      expect(send).toHaveBeenCalledTimes(1);
      const { html } = sent();
      expect(html).not.toContain('my-submissions');
      expect(html).not.toContain('修改後可以到');
      expect(html).toContain('Karina');
      expect(html).toContain('原因甲');
      expect(html).toContain('STELLAR 生咖地圖平台團隊');
    }
  );

  it.each(rejectionBatches)(
    '%s batch uses the injected isAnonymousUser',
    async (_kind, _label, pick) => {
      const email = await loadEmailService();

      await pick(email)([['a@x.com', 'u1', 'Karina', 'r']], anon);
      await pick(email)([['a@x.com', 'u1', 'Karina', 'r']], notAnon);

      expect(sent(0).html).not.toContain('my-submissions');
      expect(sent(0).html).not.toContain('修改後可以到');
      expect(sent(1).html).toContain(MY_SUBMISSIONS);
    }
  );
});

describe('TC-A03 mixed uids under one email', () => {
  it('any anonymous uid removes the link for the whole merged mail', async () => {
    const email = await loadEmailService();
    const rows = [
      { createdByEmail: 'fan@example.com', createdBy: 'uid-google', stageName: 'A', reason: 'r1' },
      { createdByEmail: 'fan@example.com', createdBy: 'uid-anon', stageName: 'B', reason: 'r2' },
    ];
    const isAnon = jest.fn((uid: string) => Promise.resolve(uid === 'uid-anon'));

    await email.sendArtistRejectionEmails(rows, isAnon);
    await email.sendArtistRejectionEmails(rows, notAnon);

    expect(send).toHaveBeenCalledTimes(2);
    expect(sent(0).html).not.toContain('my-submissions');
    expect(isAnon).toHaveBeenCalledWith('uid-google');
    expect(isAnon).toHaveBeenCalledWith('uid-anon');
    expect(sent(1).html).toContain(MY_SUBMISSIONS);
  });
});

const singleCalls = (to: string) =>
  [
    [
      'artist rejection',
      (e: Email) =>
        e.sendArtistRejectionEmail({
          email: to,
          items: [{ name: 'A', reason: 'r' }],
          showMySubmissions: true,
        }),
    ],
    [
      'event rejection',
      (e: Email) =>
        e.sendEventRejectionEmail({
          email: to,
          items: [{ name: 'A', reason: 'r' }],
          showMySubmissions: true,
        }),
    ],
    ['artist exists', (e: Email) => e.sendArtistExistsEmail({ email: to, names: ['A'] })],
  ] as const;

describe('TC-S01 Resend error is logged as failure', () => {
  it.each(singleCalls('fan@example.com'))('%s', async (_name, run) => {
    const email = await loadEmailService();
    send.mockResolvedValue(resendError);

    await expect(run(email)).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.log).not.toHaveBeenCalled();
  });
});

describe('logs carry no recipient email', () => {
  it.each(singleCalls('fan@example.com'))('%s', async (_name, run) => {
    const email = await loadEmailService();

    await run(email);
    send.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'Invalid recipient fan@example.com' },
    });
    await run(email);

    const logged = JSON.stringify([
      (console.log as jest.Mock).mock.calls,
      (console.error as jest.Mock).mock.calls.map(args => args.map(String)),
    ]);
    expect(console.error).toHaveBeenCalled();
    expect(logged).not.toContain('fan@example.com');
  });
});

describe('TC-S02 whitelist', () => {
  it.each(singleCalls('me@example.com'))(
    '%s skips a whitelisted email case-insensitively',
    async (_name, run) => {
      process.env.EMAIL_WHITELIST = 'Me@Example.com';
      const email = await loadEmailService();

      await run(email);

      expect(send).not.toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
    }
  );
});

describe('TC-S03 / TC-S04 batch resilience', () => {
  it('a failed mail does not stop the next one', async () => {
    const email = await loadEmailService();
    send
      .mockResolvedValueOnce(resendError)
      .mockResolvedValueOnce({ data: { id: 'y' }, error: null });

    await email.sendArtistRejectionEmails(
      [
        { createdByEmail: 'a@x.com', createdBy: 'u1', stageName: 'A', reason: 'r' },
        { createdByEmail: 'b@x.com', createdBy: 'u2', stageName: 'B', reason: 'r' },
      ],
      notAnon
    );

    expect(send).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledTimes(1);
  });

  it('rows without createdByEmail are skipped, the rest still sent', async () => {
    const email = await loadEmailService();

    await email.sendArtistRejectionEmails(
      [
        { createdByEmail: 'a@x.com', createdBy: 'u1', stageName: 'A', reason: 'r' },
        { createdBy: 'u2', stageName: 'B', reason: 'r' },
        { createdByEmail: 'c@x.com', createdBy: 'u3', stageName: 'C', reason: 'r' },
      ],
      notAnon
    );

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map(([a]) => a.to)).toEqual(['a@x.com', 'c@x.com']);
  });
});
