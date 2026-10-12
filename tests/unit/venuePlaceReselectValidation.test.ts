import { venueSchemas } from '../../src/middleware/validation';

const schema = venueSchemas.placeReselect;
const validId = 'ChIJN1t_tDeuEmsRUsoyG83frY4';

describe('venueSchemas.placeReselect', () => {
  it.each([
    ['空字串', { placeId: '' }],
    ['含 /', { placeId: 'ChIJ/abcdefghij' }],
    ['含 ?', { placeId: 'ChIJ?abcdefghij' }],
    ['9 字元', { placeId: 'a'.repeat(9) }],
    ['301 字元', { placeId: 'a'.repeat(301) }],
    ['非字串', { placeId: 12345678901 }],
    ['缺 placeId', {}],
  ])('placeId 非法：%s -> 驗證失敗且 field 為 placeId', (_label, body) => {
    const result = schema.safeParse(body);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path[0]).toBe('placeId');
  });

  it('缺 body 驗證失敗', () => {
    expect(schema.safeParse(undefined).success).toBe(false);
  });

  it.each([['foo'], ['']])('addressChoice 非法值 %p 驗證失敗', choice => {
    const result = schema.safeParse({ placeId: validId, addressChoice: choice });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path[0]).toBe('addressChoice');
  });

  it.each([
    ['10 字元', { placeId: 'a'.repeat(10) }],
    ['300 字元', { placeId: 'a'.repeat(300) }],
    ['含 - 與 _', { placeId: 'Ek-abc_def-ghi_' }],
    ['existing', { placeId: validId, addressChoice: 'existing' }],
    ['google', { placeId: validId, addressChoice: 'google' }],
    ['省略 addressChoice', { placeId: validId }],
  ])('合法：%s', (_label, body) => {
    expect(schema.safeParse(body).success).toBe(true);
  });
});
