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

  beforeEach(() => {
    jest.resetModules();
    send.mockClear();
    ResendMock.mockClear();
    jest.doMock('resend', () => ({ Resend: ResendMock }));
    process.env.RESEND_API_KEY = 'test-key';
    process.env.ADMIN_NOTIFY_EMAIL = 'admin@example.com';
  });

  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.ADMIN_NOTIFY_EMAIL;
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

  it('skips sending without loading resend when the key is missing', async () => {
    delete process.env.RESEND_API_KEY;
    const email = await import('../../src/services/emailService');

    await email.sendVenueSubmissionNotification('場地 A');

    expect(ResendMock).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
