import { escapeHtml } from '../../src/services/emailService';

describe('escapeHtml', () => {
  it('escapes user-controlled venue names before inserting them into email HTML', () => {
    expect(escapeHtml(`<img src=x onerror="alert('x')"> &`)).toBe(
      '&lt;img src=x onerror=&quot;alert(&#039;x&#039;)&quot;&gt; &amp;'
    );
  });
});
