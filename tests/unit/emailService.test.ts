import { escapeHtml } from '../../src/services/emailService';

describe('escapeHtml', () => {
  it('escapes user-controlled venue names before inserting them into email HTML', () => {
    expect(escapeHtml(`<img src=x onerror="alert('x')"> &`)).toBe(
      '&lt;img src=x onerror=&quot;alert(&#039;x&#039;)&quot;&gt; &amp;'
    );
  });
});

describe('resend lazy loading', () => {
  const send = jest.fn().mockResolvedValue({ data: { id: 'x' }, error: null });
  const ResendMock = jest.fn().mockImplementation(() => ({ emails: { send } }));
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    send.mockClear();
    ResendMock.mockClear();
    jest.doMock('resend', () => ({ Resend: ResendMock }));
    process.env.RESEND_API_KEY = 'test-key';
    process.env.ADMIN_NOTIFY_EMAIL = 'admin@example.com';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.dontMock('resend');
  });

  it('does not create the client at import, then creates it once across sends', async () => {
    const email = await import('../../src/services/emailService');
    expect(ResendMock).not.toHaveBeenCalled();

    await email.sendVenueSubmissionNotification('場地 A');
    await email.sendVenueSubmissionNotification('場地 B');

    expect(ResendMock).toHaveBeenCalledTimes(1);
    expect(ResendMock).toHaveBeenCalledWith('test-key');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'admin@example.com' }));
  });

  it('retries creating the client after a failed first load', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    ResendMock.mockImplementationOnce(() => {
      throw new Error('init failed');
    });
    const email = await import('../../src/services/emailService');

    await email.sendVenueSubmissionNotification('場地 A');
    expect(send).not.toHaveBeenCalled();

    await email.sendVenueSubmissionNotification('場地 B');
    expect(ResendMock).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it('skips sending without loading resend when the key is missing', async () => {
    delete process.env.RESEND_API_KEY;
    const email = await import('../../src/services/emailService');

    await email.sendVenueSubmissionNotification('場地 A');

    expect(ResendMock).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
