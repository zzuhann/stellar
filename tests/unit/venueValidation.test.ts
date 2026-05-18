import { venueSchemas } from '../../src/middleware/validation';

const regionSchema = venueSchemas.create.shape.region;

describe('venue region validation', () => {
  test.each([
    ['台北', '台北'],
    ['臺北', '台北'],
    ['臺中', '台中'],
    ['臺南', '台南'],
    ['臺東', '台東'],
  ])('accepts "%s" and normalizes to "%s"', (input, expected) => {
    const result = regionSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(expected);
  });

  it('rejects invalid region', () => {
    expect(regionSchema.safeParse('東京').success).toBe(false);
  });

  it('rejects empty string', () => {
    expect(regionSchema.safeParse('').success).toBe(false);
  });
});
