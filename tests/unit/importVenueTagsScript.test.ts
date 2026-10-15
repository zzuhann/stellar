import fs from 'fs';
import os from 'os';
import path from 'path';

const mockBatchUpdate = jest.fn();
const mockBatchCommit = jest.fn();
const mockDocUpdate = jest.fn();
const mockDocSet = jest.fn();
const mockVenuesGet = jest.fn();

jest.mock('../../src/config/firebase', () => ({
  hasFirebaseConfig: true,
  db: {
    collection: () => ({
      get: () => mockVenuesGet(),
      doc: (id: string) => ({ id, update: mockDocUpdate, set: mockDocSet }),
    }),
    batch: () => ({ update: mockBatchUpdate, commit: mockBatchCommit }),
  },
}));

import { run } from '../../src/scripts/import-venue-tags';

const quote = (cell: string) => `"${cell.replace(/"/g, '""')}"`;
const writeCsv = (rows: string[][]) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'venue-tags-')), 'sheet.csv');
  fs.writeFileSync(file, rows.map(r => r.map(quote).join(',')).join('\n'));
  return file;
};

const HEADERS = [
  'venue_id',
  '場地名稱',
  '整理狀態',
  '價格｜免場地費 (free_venue)',
  '價格｜需押金 (deposit)',
  '服務｜可佈置 (can_decorate)',
  '店家提供的設備',
  '備註',
];

const venueDocs = [
  {
    id: 'a',
    data: () => ({
      name: 'A',
      tags: [{ slug: 'can_decorate' }, { slug: 'free_venue' }],
      equipmentNote: '音響',
      hostTags: ['大空間'],
      description: '原本的說明',
    }),
  },
  { id: 'b', data: () => ({ name: 'B', tags: [{ slug: 'can_decorate' }], equipmentNote: '' }) },
  { id: 'untouched', data: () => ({ name: '不在表上', tags: [{ slug: 'deposit' }] }) },
];

let logs: string[];

beforeEach(() => {
  jest.clearAllMocks();
  mockVenuesGet.mockResolvedValue({ docs: venueDocs });
  mockBatchCommit.mockResolvedValue(undefined);
  logs = [];
  jest.spyOn(console, 'log').mockImplementation((...args) => void logs.push(args.join(' ')));
  jest.spyOn(console, 'error').mockImplementation((...args) => void logs.push(args.join(' ')));
});

afterEach(() => {
  jest.restoreAllMocks();
});

// a：deposit 新增、free_venue 改成限期、設備改變；b：沒變
const validCsv = () =>
  writeCsv([
    HEADERS,
    ['a', 'A', '已確認', 'v 2026-12-31', 'v', 'v', '投影機', '備註文字'],
    ['b', 'B', '已確認', '', '', 'v', '', ''],
  ]);

describe('import-venue-tags 腳本主流程', () => {
  it('TC-006 a：不帶 --commit 一筆都不寫，但印出差異與統計', async () => {
    const code = await run({ csvPath: validCsv(), commit: false });

    expect(code).toBe(0);
    expect(mockBatchUpdate).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
    expect(mockDocUpdate).not.toHaveBeenCalled();
    expect(mockDocSet).not.toHaveBeenCalled();

    const out = logs.join('\n');
    expect(out).toContain('+ deposit');
    expect(out).toContain('~ free_venue: 不限期 → 至 2026-12-31');
    expect(out).toContain('音響');
    expect(out).toContain('投影機');
    expect(out).toMatch(/已確認 2 列.*有變動 1 家.*沒有變動 1 家.*略過.*0 列/);
  });

  it('TC-006 b：--commit 只寫有變動的場地，key 只有 tags、表上的附加欄位、updatedAt', async () => {
    const code = await run({ csvPath: validCsv(), commit: true });

    expect(code).toBe(0);
    expect(mockBatchUpdate).toHaveBeenCalledTimes(1);
    const [ref, written] = mockBatchUpdate.mock.calls[0];
    expect(ref.id).toBe('a');
    expect(Object.keys(written).sort()).toEqual(['equipmentNote', 'tags', 'updatedAt']);
    expect(written.tags).toEqual([
      { slug: 'free_venue', limited: true, until: '2026-12-31' },
      { slug: 'deposit' },
      { slug: 'can_decorate' },
    ]);
    expect(written.equipmentNote).toBe('投影機');
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);

    const out = logs.join('\n');
    expect(out).toContain('/api/cache/clear');
    expect(out).toContain('/api/revalidate');
  });

  it('TC-079 a：多種錯誤一次全部列出，不寫入，exit 1', async () => {
    const csv = writeCsv([
      [...HEADERS, '價格｜亂寫 (unknown_tag)'],
      ['a', 'A', '已確認', 'v?', '', 'v', '', '', ''],
      ['a', 'A', '已確認', '', '', 'v', '', '', ''],
    ]);

    const code = await run({ csvPath: csv, commit: true });

    expect(code).toBe(1);
    expect(mockBatchUpdate).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
    const out = logs.join('\n');
    expect(out).toContain('unknown_tag');
    expect(out).toContain('v?');
    expect(out).toMatch(/venue_id.*重複|重複.*venue_id/);
  });

  it('TC-079 b：batch.commit 失敗 → exit 非 0，印出原因，不印成功與清快取提醒', async () => {
    mockBatchCommit.mockRejectedValue(new Error('DEADLINE_EXCEEDED'));

    const code = await run({ csvPath: validCsv(), commit: true });

    expect(code).not.toBe(0);
    const out = logs.join('\n');
    expect(out).toContain('DEADLINE_EXCEEDED');
    expect(out).not.toContain('/api/cache/clear');
    expect(out).not.toMatch(/寫入完成/);
  });
});
