import { artistSchemas, eventSchemas } from '../../src/middleware/validation';

// 真實情境下的 id 皆來自 this.collection.doc() 的 Firestore 自動 id：20 碼英數字
const VALID_ID = 'aBcD12345XyZ67890abc';

describe('artistSchemas.batchReview', () => {
  const build = (updates: Array<Record<string, unknown>>) => ({ updates });

  it('accepts a normal batch of unique, valid ids', () => {
    const result = artistSchemas.batchReview.safeParse(
      build([
        { artistId: VALID_ID, status: 'approved' },
        { artistId: 'anotherValidId000000', status: 'rejected', reason: '資料不完整' },
      ])
    );
    expect(result.success).toBe(true);
  });

  it('rejects an artistId containing "/" instead of letting it reach Firestore as a bad path', () => {
    const result = artistSchemas.batchReview.safeParse(build([{ artistId: 'a/b', status: 'approved' }]));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path.join('.')).toBe('updates.0.artistId');
    }
  });

  it('rejects a batch with a duplicate artistId', () => {
    const result = artistSchemas.batchReview.safeParse(
      build([
        { artistId: VALID_ID, status: 'approved' },
        { artistId: VALID_ID, status: 'rejected' },
      ])
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['updates', 1, 'artistId']);
      expect(result.error.issues[0].message).toContain(VALID_ID);
    }
  });

  it('trims groupNames before checking for blank entries', () => {
    const result = artistSchemas.batchReview.safeParse(
      build([{ artistId: VALID_ID, status: 'approved', groupNames: ['   '] }])
    );
    expect(result.success).toBe(false);
  });

  it('accepts groupNames with surrounding whitespace and trims them', () => {
    const result = artistSchemas.batchReview.safeParse(
      build([{ artistId: VALID_ID, status: 'approved', groupNames: ['  IVE  '] }])
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.updates[0].groupNames).toEqual(['IVE']);
    }
  });
});

describe('eventSchemas.batchReview', () => {
  const build = (updates: Array<Record<string, unknown>>) => ({ updates });

  it('accepts a normal batch of unique, valid ids', () => {
    const result = eventSchemas.batchReview.safeParse(
      build([
        { eventId: VALID_ID, status: 'approved' },
        { eventId: 'anotherValidId000000', status: 'rejected' },
      ])
    );
    expect(result.success).toBe(true);
  });

  it('rejects an eventId containing "/" instead of letting it reach Firestore as a bad path', () => {
    const result = eventSchemas.batchReview.safeParse(build([{ eventId: 'a/b', status: 'approved' }]));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path.join('.')).toBe('updates.0.eventId');
    }
  });

  it('rejects a batch with a duplicate eventId even when statuses conflict', () => {
    const result = eventSchemas.batchReview.safeParse(
      build([
        { eventId: VALID_ID, status: 'approved' },
        { eventId: VALID_ID, status: 'rejected' },
      ])
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['updates', 1, 'eventId']);
      expect(result.error.issues[0].message).toContain(VALID_ID);
    }
  });
});

describe('artistSchemas groupNames trim ordering (create/update)', () => {
  it('rejects a whitespace-only groupName on create', () => {
    expect(
      artistSchemas.create.safeParse({ stageName: '測試藝人', groupNames: ['   '] }).success
    ).toBe(false);
  });

  it('rejects a whitespace-only groupName on update', () => {
    expect(artistSchemas.update.safeParse({ groupNames: ['   '] }).success).toBe(false);
  });

  it('trims a valid groupName with surrounding whitespace on create', () => {
    const result = artistSchemas.create.safeParse({
      stageName: '測試藝人',
      groupNames: ['  IVE  '],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.groupNames).toEqual(['IVE']);
  });
});
