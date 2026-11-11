import { escapeHtml } from '../../src/services/emailService';

describe('escapeHtml', () => {
  it('escapes user-controlled venue names before inserting them into email HTML', () => {
    expect(escapeHtml(`<img src=x onerror="alert('x')"> &`)).toBe(
      '&lt;img src=x onerror=&quot;alert(&#039;x&#039;)&quot;&gt; &amp;'
    );
  });
});

describe('resend lazy loading', () => {
  const send = jest.fn();
  const ResendMock = jest.fn().mockImplementation(() => ({ emails: { send } }));
  const originalEnv = { ...process.env };
  let moduleLoads = 0;
  let failModuleLoad = false;
  const captureException = jest.fn();

  const loadEmailService = () => import('../../src/services/emailService');

  beforeEach(() => {
    jest.resetModules();
    captureException.mockClear();
    jest.doMock('@sentry/node', () => ({ captureException }));
    send.mockReset().mockResolvedValue({ data: { id: 'x' }, error: null });
    ResendMock.mockClear();
    moduleLoads = 0;
    failModuleLoad = false;
    jest.doMock('resend', () => {
      moduleLoads++;
      if (failModuleLoad) throw new Error('module load failed');
      return { Resend: ResendMock };
    });
    process.env.RESEND_API_KEY = 'test-key';
    process.env.ADMIN_NOTIFY_EMAIL = 'admin@example.com';
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

  it('does not load the resend module at import, then loads it once across sends', async () => {
    const email = await loadEmailService();
    expect(moduleLoads).toBe(0);

    await email.sendVenueSubmissionNotification('場地 A');
    await email.sendVenueSubmissionNotification('場地 B');

    expect(moduleLoads).toBe(1);
    expect(ResendMock).toHaveBeenCalledTimes(1);
    expect(ResendMock).toHaveBeenCalledWith('test-key');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'admin@example.com' }));
  });

  it('logs a failed module load without throwing, and retries on the next send', async () => {
    failModuleLoad = true;
    const email = await loadEmailService();

    await expect(email.sendVenueSubmissionNotification('場地 A')).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledTimes(1);

    failModuleLoad = false;
    await email.sendVenueSubmissionNotification('場地 B');
    expect(moduleLoads).toBe(2);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('retries creating the client after the constructor fails', async () => {
    ResendMock.mockImplementationOnce(() => {
      throw new Error('init failed');
    });
    const email = await loadEmailService();

    await email.sendVenueSubmissionNotification('場地 A');
    expect(send).not.toHaveBeenCalled();

    await email.sendVenueSubmissionNotification('場地 B');
    expect(ResendMock).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('skips sending without loading resend when the key is missing', async () => {
    delete process.env.RESEND_API_KEY;
    const email = await loadEmailService();

    await email.sendVenueSubmissionNotification('場地 A');

    expect(moduleLoads).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('skips admin notifications without loading resend when the admin email is missing', async () => {
    delete process.env.ADMIN_NOTIFY_EMAIL;
    const email = await loadEmailService();

    await email.sendEventSubmissionNotification('fan@example.com', '活動');

    expect(moduleLoads).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('skips admin notifications for whitelisted submitters', async () => {
    process.env.EMAIL_WHITELIST = 'Me@Example.com';
    const email = await loadEmailService();

    await email.sendArtistSubmissionNotification('me@example.com', '藝人');

    expect(moduleLoads).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('treats a Resend error result as a failed send and reports it to Sentry', async () => {
    send.mockResolvedValueOnce({
      data: null,
      error: { name: 'rate_limit_exceeded', message: 'x' },
    });
    const email = await loadEmailService();

    await email.sendVenueSubmissionNotification('場地 A');

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.log).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { context: 'email_send' },
    });
  });

  describe('sendContactNotification', () => {
    const contact = { name: '小明', email: 'fan@example.com', message: 'hi' };
    const sentTo = () => send.mock.calls.map(([arg]) => arg.to);

    it('sends the STELLAR notification before the confirmation', async () => {
      const email = await loadEmailService();

      await expect(email.sendContactNotification(contact)).resolves.toBeUndefined();
      expect(sentTo()).toEqual(['stellar.taiwan.2025@gmail.com', 'fan@example.com']);
    });

    it('throws without sending the confirmation when the STELLAR notification fails', async () => {
      send.mockResolvedValueOnce({
        data: null,
        error: { name: 'application_error', message: 'x' },
      });
      const email = await loadEmailService();

      await expect(email.sendContactNotification(contact)).rejects.toThrow('Resend');
      expect(sentTo()).toEqual(['stellar.taiwan.2025@gmail.com']);
    });

    it('resolves and reports to Sentry when only the confirmation fails', async () => {
      send
        .mockResolvedValueOnce({ data: { id: 'x' }, error: null })
        .mockResolvedValueOnce({ data: null, error: { name: 'validation_error', message: 'x' } });
      const email = await loadEmailService();

      await expect(email.sendContactNotification(contact)).resolves.toBeUndefined();
      expect(captureException).toHaveBeenCalledTimes(1);
    });

    it('throws when the resend module fails to load', async () => {
      failModuleLoad = true;
      const email = await loadEmailService();

      await expect(email.sendContactNotification(contact)).rejects.toThrow('module load failed');
      expect(send).not.toHaveBeenCalled();
    });
  });
});

describe('email templates escape user input', () => {
  const send = jest.fn();
  const originalEnv = { ...process.env };
  const payload = `<a href="https://evil.example">驗證帳號</a>`;
  const escapedPayload = escapeHtml(payload);

  const loadEmailService = () => import('../../src/services/emailService');
  const sentHtml = (to: string) =>
    (send.mock.calls.find(([arg]) => arg.to === to)?.[0] as { html: string }).html;

  beforeEach(() => {
    jest.resetModules();
    send.mockReset().mockResolvedValue({ data: { id: 'x' }, error: null });
    jest.doMock('resend', () => ({ Resend: jest.fn(() => ({ emails: { send } })) }));
    process.env.RESEND_API_KEY = 'test-key';
    process.env.ADMIN_NOTIFY_EMAIL = 'admin@example.com';
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.dontMock('resend');
    jest.restoreAllMocks();
  });

  it('contact confirmation does not echo any user input', async () => {
    const email = await loadEmailService();

    await email.sendContactNotification({
      name: payload,
      email: 'victim@example.com',
      message: payload,
    });

    const html = sentHtml('victim@example.com');
    expect(html).toContain('<p>你好～</p>');
    expect(html).not.toContain('evil.example');
  });

  it('contact notification to STELLAR escapes name, email and message', async () => {
    const email = await loadEmailService();

    await email.sendContactNotification({
      name: payload,
      email: 'a"<b>@example.com',
      message: payload,
    });

    const html = sentHtml('stellar.taiwan.2025@gmail.com');
    expect(html).not.toContain(payload);
    expect(html).toContain(escapedPayload);
    expect(html).toContain('a&quot;&lt;b&gt;@example.com');
  });

  it('event approval escapes titles and display name, and encodes the event id in links', async () => {
    const email = await loadEmailService();

    await email.sendEventApprovalEmail({
      email: 'fan@example.com',
      displayName: payload,
      events: [{ id: 'abc"><x', title: payload }],
    });

    const html = sentHtml('fan@example.com');
    expect(html).not.toContain(payload);
    expect(html).toContain(escapedPayload);
    expect(html).toContain('href="https://www.stellar-zone.com/event/abc%22%3E%3Cx"');
  });

  it('artist approval escapes artist names and display name', async () => {
    const email = await loadEmailService();

    await email.sendArtistApprovalEmail({
      email: 'fan@example.com',
      displayName: payload,
      artistNames: [payload],
    });

    const html = sentHtml('fan@example.com');
    expect(html).not.toContain(payload);
    expect(html).toContain(escapedPayload);
  });

  it.each([
    ['artist', 'sendArtistSubmissionNotification'],
    ['event', 'sendEventSubmissionNotification'],
  ] as const)('%s submission notification escapes the name and submitter', async (_, fn) => {
    const email = await loadEmailService();

    await email[fn]('x"<b>@example.com', payload);

    const html = sentHtml('admin@example.com');
    expect(html).not.toContain(payload);
    expect(html).toContain(escapedPayload);
    expect(html).toContain('x&quot;&lt;b&gt;@example.com');
  });
});
