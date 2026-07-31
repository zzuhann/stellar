jest.mock('../../src/config/r2-client', () => ({
  hasR2Config: true,
  r2Client: { send: jest.fn().mockResolvedValue({}) },
  R2_BUCKET_NAME: 'test-bucket',
  R2_PUBLIC_URL: 'https://cdn.example.com',
}));

jest.mock('../../src/utils/ssrfGuard', () => ({
  fetchWithSsrfGuard: jest.fn(),
}));

import { ImageService } from '../../src/services/imageService';
import { fetchWithSsrfGuard } from '../../src/utils/ssrfGuard';
import { r2Client } from '../../src/config/r2-client';

const mockFetchWithSsrfGuard = fetchWithSsrfGuard as jest.Mock;
const mockSend = (r2Client as unknown as { send: jest.Mock }).send;

// 合法 PNG signature + 補到超過 minSize（1KB）的 padding
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function fakePngBuffer(size = 2048): Buffer {
  const buffer = Buffer.alloc(size);
  PNG_SIGNATURE.copy(buffer, 0);
  return buffer;
}

describe('ImageService.uploadImageFromUrl', () => {
  let service: ImageService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
    service = new ImageService();
  });

  it('成功抓取合法圖片並上傳到 R2', async () => {
    const body = fakePngBuffer();
    mockFetchWithSsrfGuard.mockResolvedValue({
      ok: true,
      response: new Response(body, { status: 200, headers: { 'content-type': 'image/png' } }),
    });

    const result = await service.uploadImageFromUrl('https://example.com/cat.png');

    expect(result.success).toBe(true);
    expect(result.imageUrl).toMatch(/^https:\/\/cdn\.example\.com\/images\//);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('SSRF 防護擋下網址時，回傳 blocked_host，不呼叫 R2', async () => {
    mockFetchWithSsrfGuard.mockResolvedValue({
      ok: false,
      reason: 'blocked_host',
      error: '不允許存取內部網路位址',
    });

    const result = await service.uploadImageFromUrl('http://169.254.169.254/secret');

    expect(result).toEqual({
      success: false,
      error: '不允許存取內部網路位址',
      reason: 'blocked_host',
    });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('來源網址無法連線時，回傳 fetch_failed', async () => {
    mockFetchWithSsrfGuard.mockResolvedValue({
      ok: false,
      reason: 'fetch_failed',
      error: '來源圖片無法取得，網址可能已失效',
    });

    const result = await service.uploadImageFromUrl('https://example.com/missing.png');

    expect(result.success).toBe(false);
    expect(result.reason).toBe('fetch_failed');
  });

  it('來源回應非 2xx 時，回傳 fetch_failed', async () => {
    mockFetchWithSsrfGuard.mockResolvedValue({
      ok: true,
      response: new Response('not found', { status: 404 }),
    });

    const result = await service.uploadImageFromUrl('https://example.com/gone.png');

    expect(result.success).toBe(false);
    expect(result.reason).toBe('fetch_failed');
  });

  it('content-type 不是允許的圖片格式時，回傳 invalid_content_type，不下載內容', async () => {
    mockFetchWithSsrfGuard.mockResolvedValue({
      ok: true,
      response: new Response('<html>not an image</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    });

    const result = await service.uploadImageFromUrl('https://example.com/page.html');

    expect(result).toEqual({
      success: false,
      error: '來源網址不是支援的圖片格式',
      reason: 'invalid_content_type',
    });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('檔案內容超過 5MB 上限時，回傳 size_out_of_range', async () => {
    const oversized = Buffer.alloc(5 * 1024 * 1024 + 1);
    PNG_SIGNATURE.copy(oversized, 0);
    mockFetchWithSsrfGuard.mockResolvedValue({
      ok: true,
      response: new Response(oversized, { status: 200, headers: { 'content-type': 'image/png' } }),
    });

    const result = await service.uploadImageFromUrl('https://example.com/huge.png');

    expect(result).toEqual({
      success: false,
      error: '圖片檔案過大',
      reason: 'size_out_of_range',
    });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('content-type 宣稱是圖片但實際內容 magic bytes 不符時，回傳 unsupported_format', async () => {
    const fakeBody = Buffer.alloc(2048, 'not a real png');
    mockFetchWithSsrfGuard.mockResolvedValue({
      ok: true,
      response: new Response(fakeBody, { status: 200, headers: { 'content-type': 'image/png' } }),
    });

    const result = await service.uploadImageFromUrl('https://example.com/fake.png');

    expect(result.success).toBe(false);
    expect(result.reason).toBe('unsupported_format');
    expect(mockSend).not.toHaveBeenCalled();
  });
});
