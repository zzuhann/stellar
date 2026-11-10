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

  const loadEmailService = () => import('../../src/services/emailService');

  beforeEach(() => {
    jest.resetModules();
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

  describe('sendContactNotification', () => {
    const contact = { name: '小明', email: 'fan@example.com', message: 'hi' };

    it('resolves when only one of the two emails fails', async () => {
      send.mockRejectedValueOnce(new Error('confirm failed'));
      const email = await loadEmailService();

      await expect(email.sendContactNotification(contact)).resolves.toBeUndefined();
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('throws when both emails fail, same as before lazy loading', async () => {
      send.mockRejectedValue(new Error('send failed'));
      const email = await loadEmailService();

      await expect(email.sendContactNotification(contact)).rejects.toThrow(
        'Failed to send both contact emails'
      );
    });

    it('throws when the resend module fails to load, since neither email can be sent', async () => {
      failModuleLoad = true;
      const email = await loadEmailService();

      await expect(email.sendContactNotification(contact)).rejects.toThrow(
        'Failed to send both contact emails'
      );
      expect(send).not.toHaveBeenCalled();
    });
  });
});
