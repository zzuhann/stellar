import { artistSchemas } from '../../src/middleware/validation';

describe('artistSchemas birthday calendar validity', () => {
  it('create: rejects a birthday with a valid format but nonexistent calendar date', () => {
    const result = artistSchemas.create.safeParse({
      stageName: '測試藝人',
      birthday: '2026-02-31',
    });
    expect(result.success).toBe(false);
  });

  it('update: rejects a birthday with a valid format but nonexistent calendar date', () => {
    const result = artistSchemas.update.safeParse({
      birthday: '2026-02-31',
    });
    expect(result.success).toBe(false);
  });

  it('create: accepts a real calendar date', () => {
    const result = artistSchemas.create.safeParse({
      stageName: '測試藝人',
      birthday: '2026-02-28',
    });
    expect(result.success).toBe(true);
  });

  it('update: accepts a real calendar date', () => {
    const result = artistSchemas.update.safeParse({
      birthday: '2026-02-28',
    });
    expect(result.success).toBe(true);
  });

  it('create: accepts a leap-day birthday', () => {
    const result = artistSchemas.create.safeParse({
      stageName: '測試藝人',
      birthday: '2024-02-29',
    });
    expect(result.success).toBe(true);
  });

  it('create: rejects a malformed (non-YYYY-MM-DD) format', () => {
    const result = artistSchemas.create.safeParse({
      stageName: '測試藝人',
      birthday: '2026/02/28',
    });
    expect(result.success).toBe(false);
  });

  it('create: accepts a missing (optional) birthday', () => {
    const result = artistSchemas.create.safeParse({
      stageName: '測試藝人',
    });
    expect(result.success).toBe(true);
  });
});
