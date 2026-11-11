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
    const result = artistSchemas.batchReview.safeParse(
      build([{ artistId: 'a/b', status: 'approved' }])
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path.join('.')).toBe('updates.0.artistId');
    }
  });

  it('rejects a batch with a duplicate artistId', () => {
    const result = artistSchemas.batchReview.safeParse(
      build([
        { artistId: VALID_ID, status: 'approved' },
        { artistId: VALID_ID, status: 'rejected', reason: '資料不完整' },
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
        { eventId: 'anotherValidId000000', status: 'rejected', reason: '資料不完整' },
      ])
    );
    expect(result.success).toBe(true);
  });

  it('rejects an eventId containing "/" instead of letting it reach Firestore as a bad path', () => {
    const result = eventSchemas.batchReview.safeParse(
      build([{ eventId: 'a/b', status: 'approved' }])
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path.join('.')).toBe('updates.0.eventId');
    }
  });

  it('rejects a batch with a duplicate eventId even when statuses conflict', () => {
    const result = eventSchemas.batchReview.safeParse(
      build([
        { eventId: VALID_ID, status: 'approved' },
        { eventId: VALID_ID, status: 'rejected', reason: '資料不完整' },
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

const REQUIRED_MSG = '拒絕原因為必填';
const TOO_LONG_MSG = '拒絕原因不能超過 500 個字元';

describe('rejected reason is required (single review / reject schemas)', () => {
  const failing = (schema: { safeParse: (v: unknown) => unknown }, body: unknown) => {
    const result = schema.safeParse(body) as {
      success: boolean;
      error?: { issues: Array<{ path: unknown[]; message: string }> };
    };
    expect(result.success).toBe(false);
    return result.error!.issues[0];
  };

  const reviewSchemas = [
    ['artistSchemas.review', artistSchemas.review],
    ['eventSchemas.review', eventSchemas.review],
  ] as const;
  const rejectSchemas = [
    ['artistSchemas.reject', artistSchemas.reject],
    ['eventSchemas.reject', eventSchemas.reject],
  ] as const;
  // review schemas need status, reject schemas only take reason
  const allSchemas = [
    ...reviewSchemas.map(([n, s]) => [n, s, { status: 'rejected' }] as const),
    ...rejectSchemas.map(([n, s]) => [n, s, {}] as const),
  ];

  it.each(allSchemas)('%s: missing reason fails with the Chinese message', (_n, schema, base) => {
    const issue = failing(schema, base);
    expect(issue.path).toEqual(['reason']);
    expect(issue.message).toBe(REQUIRED_MSG);
  });

  it.each(allSchemas)('%s: empty or whitespace-only reason fails', (_n, schema, base) => {
    expect(failing(schema, { ...base, reason: '' }).message).toBe(REQUIRED_MSG);
    expect(failing(schema, { ...base, reason: '   ' }).message).toBe(REQUIRED_MSG);
  });

  it.each(rejectSchemas)('%s: non-string reason fails with the Chinese message', (_n, schema) => {
    expect(failing(schema, { reason: 123 }).message).toBe(REQUIRED_MSG);
  });

  it.each(allSchemas)(
    '%s: 500 chars pass, 501 and 500+trailing spaces fail',
    (_n, schema, base) => {
      expect(schema.safeParse({ ...base, reason: 'a'.repeat(500) }).success).toBe(true);
      expect(failing(schema, { ...base, reason: 'a'.repeat(501) }).message).toBe(TOO_LONG_MSG);
      expect(failing(schema, { ...base, reason: 'a'.repeat(500) + '  ' }).message).toBe(
        TOO_LONG_MSG
      );
    }
  );

  it.each(allSchemas)('%s: reason is trimmed after parsing', (_n, schema, base) => {
    const result = schema.safeParse({ ...base, reason: '  原因  ' });
    expect(result.success).toBe(true);
    if (result.success) expect((result.data as { reason: string }).reason).toBe('原因');
  });

  it.each(reviewSchemas)('%s: approved without reason passes', (_n, schema) => {
    expect(schema.safeParse({ status: 'approved' }).success).toBe(true);
  });

  it('artistSchemas.review: exists without reason passes', () => {
    expect(artistSchemas.review.safeParse({ status: 'exists' }).success).toBe(true);
  });

  it('eventSchemas.review: status exists is rejected', () => {
    expect(eventSchemas.review.safeParse({ status: 'exists' }).success).toBe(false);
  });
});

describe('rejected reason is required (batchReview schemas)', () => {
  const cases = [
    ['artistSchemas.batchReview', artistSchemas.batchReview, 'artistId'],
    ['eventSchemas.batchReview', eventSchemas.batchReview, 'eventId'],
  ] as const;
  const build = (key: string, second: Record<string, unknown>) => ({
    updates: [
      { [key]: VALID_ID, status: 'approved' },
      { [key]: 'anotherValidId000000', status: 'rejected', ...second },
    ],
  });

  it.each(cases)(
    '%s: rejected without reason / blank reason fails at updates.1.reason',
    (_n, schema, key) => {
      for (const second of [{}, { reason: '   ' }]) {
        const result = schema.safeParse(build(key, second));
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].path).toEqual(['updates', 1, 'reason']);
          expect(result.error.issues[0].message).toBe(REQUIRED_MSG);
        }
      }
    }
  );

  it.each(cases)(
    '%s: 500 chars + trailing spaces fails with the too-long message',
    (_n, schema, key) => {
      const result = schema.safeParse(build(key, { reason: 'a'.repeat(500) + '  ' }));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['updates', 1, 'reason']);
        expect(result.error.issues[0].message).toBe(TOO_LONG_MSG);
      }
    }
  );

  it('artistSchemas.batchReview: exists without reason still passes', () => {
    const result = artistSchemas.batchReview.safeParse({
      updates: [{ artistId: VALID_ID, status: 'exists' }],
    });
    expect(result.success).toBe(true);
  });
});

describe('artistSchemas.review adminUpdate.groupNames', () => {
  it('keeps and trims groupNames instead of stripping adminUpdate', () => {
    const result = artistSchemas.review.safeParse({
      status: 'approved',
      adminUpdate: { groupNames: ['  aespa  '] },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.adminUpdate?.groupNames).toEqual(['aespa']);
  });

  it('rejects a whitespace-only groupName like batchReview does', () => {
    const result = artistSchemas.review.safeParse({
      status: 'approved',
      adminUpdate: { groupNames: ['   '] },
    });
    expect(result.success).toBe(false);
  });
});
