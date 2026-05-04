import { Timestamp } from 'firebase-admin/firestore';
import { generateEventSlug } from '../../src/utils/eventSlug';

const makeTimestamp = (isoDate: string): Timestamp =>
  ({ toDate: () => new Date(isoDate) }) as unknown as Timestamp;

describe('generateEventSlug', () => {
  const firestoreId = 'xK2mNpABCDEF';
  const startTimestamp = makeTimestamp('2025-04-15T00:00:00Z');

  it('1 個藝人：直接用 slug', () => {
    expect(generateEventSlug(['bts'], startTimestamp, firestoreId)).toBe('bts-2025-04-xK2mNp');
  });

  it('2 個藝人：用 - 連接', () => {
    expect(generateEventSlug(['bts', 'txt'], startTimestamp, firestoreId)).toBe(
      'bts-txt-2025-04-xK2mNp'
    );
  });

  it('3 個藝人：取前兩個加 collab', () => {
    expect(generateEventSlug(['bts', 'txt', 'ive'], startTimestamp, firestoreId)).toBe(
      'bts-txt-collab-2025-04-xK2mNp'
    );
  });

  it('4 個藝人：仍只取前兩個加 collab', () => {
    expect(generateEventSlug(['bts', 'txt', 'ive', 'aespa'], startTimestamp, firestoreId)).toBe(
      'bts-txt-collab-2025-04-xK2mNp'
    );
  });

  it('月份補零', () => {
    const jan = makeTimestamp('2025-01-05T00:00:00Z');
    expect(generateEventSlug(['bts'], jan, firestoreId)).toBe('bts-2025-01-xK2mNp');
  });

  it('firestoreId 只取前六碼', () => {
    expect(generateEventSlug(['bts'], startTimestamp, 'ABCDEF1234')).toBe('bts-2025-04-ABCDEF');
  });

  it('firestoreId 不足六碼時取全部', () => {
    expect(generateEventSlug(['bts'], startTimestamp, 'AB')).toBe('bts-2025-04-AB');
  });
});
