import { escapeHtml } from '../../src/services/emailService';

describe('escapeHtml', () => {
  it('escapes user-controlled venue names before inserting them into email HTML', () => {
    expect(escapeHtml(`<img src=x onerror="alert('x')"> &`)).toBe(
      '&lt;img src=x onerror=&quot;alert(&#039;x&#039;)&quot;&gt; &amp;'
    );
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
