import { Timestamp } from 'firebase-admin/firestore';
import { Artist } from '../../src/models/types';
import { toPublicArtist } from '../../src/utils/artistSanitizer';

const makeTimestamp = (isoDate: string): Timestamp =>
  ({ toDate: () => new Date(isoDate) }) as Timestamp;

const baseArtist = (overrides: Partial<Artist> = {}): Artist =>
  ({
    id: 'artist-1',
    stageName: 'Test Artist',
    stageNameZh: '測試藝人',
    birthday: '2000-01-01',
    status: 'approved',
    createdBy: 'uid-owner',
    createdByEmail: 'owner@example.com',
    createdAt: makeTimestamp('2024-12-01'),
    updatedAt: makeTimestamp('2024-12-01'),
    ...overrides,
  }) as Artist;

describe('toPublicArtist', () => {
  it('移除 createdBy 與 createdByEmail 欄位', () => {
    const result = toPublicArtist(baseArtist());
    expect(result).not.toHaveProperty('createdBy');
    expect(result).not.toHaveProperty('createdByEmail');
  });

  it('createdByEmail 為 undefined 時仍正常運作、不拋錯', () => {
    const artist = baseArtist({ createdByEmail: undefined });
    const result = toPublicArtist(artist);
    expect(result).not.toHaveProperty('createdBy');
    expect(result).not.toHaveProperty('createdByEmail');
  });

  it('移除 rejectedReason 欄位（管理員拒絕原因不應公開，getArtistById 未依 status 過濾）', () => {
    const artist = baseArtist({
      status: 'rejected',
      rejectedReason: '資料不完整，缺少官方帳號連結',
    });
    const result = toPublicArtist(artist);
    expect(result).not.toHaveProperty('rejectedReason');
  });

  it('保留其他所有欄位不受影響', () => {
    const artist = baseArtist({ stageName: 'IU', birthday: '1993-05-16' });
    const result = toPublicArtist(artist);
    expect(result.stageName).toBe('IU');
    expect(result.birthday).toBe('1993-05-16');
    expect(result.id).toBe('artist-1');
    expect(result.status).toBe('approved');
  });

  it('不修改原始物件（避免共用快取被意外污染）', () => {
    const artist = baseArtist();
    toPublicArtist(artist);
    expect(artist).toHaveProperty('createdBy');
    expect(artist).toHaveProperty('createdByEmail');
    expect(artist.createdBy).toBe('uid-owner');
  });

  it('回傳型別不含 createdBy/createdByEmail/rejectedReason（compile-time 防退步：若實作退回 as T 蓋型別，這裡會編譯失敗）', () => {
    const result = toPublicArtist(baseArtist());
    // @ts-expect-error createdBy 不應存在於回傳型別上
    void result.createdBy;
    // @ts-expect-error createdByEmail 不應存在於回傳型別上
    void result.createdByEmail;
    // @ts-expect-error rejectedReason 不應存在於回傳型別上
    void result.rejectedReason;
  });
});
