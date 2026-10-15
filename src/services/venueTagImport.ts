// Pure parse/validate/diff for the venue tag backfill sheet import.
// Spec: specs/features/venue-tags/design-backend.md §6. The script only does IO.

import { VENUE_TAGS } from '../constants/venueTags';
import { VenueTag } from '../models/types';
import { isValidCalendarDate } from '../utils/calendarDate';

export interface ExistingVenueTagFields {
  name?: string;
  tags?: Array<{ slug: string; limited?: boolean; until?: string }>;
  sourceLinks?: string[];
  equipmentNote?: string;
  infoUpdatedOn?: string | null;
  calendarUrl?: string | null;
}

export interface VenueTagChange {
  venueId: string;
  rowNumber: number;
  name: string;
  // Whole-overwrite payload: tags + every extra column present on the sheet
  update: Record<string, unknown>;
  lines: string[];
}

export interface ImportPlan {
  errors: string[];
  warnings: string[];
  changes: VenueTagChange[];
  stats: { confirmed: number; changed: number; unchanged: number; skipped: number };
}

type ParsedHeader =
  | { kind: 'tag'; slug: string }
  | { kind: 'deferred' }
  | { kind: 'malformed' }
  | { kind: 'other' };

const TAG_HEADER = /^[^｜]+｜.+ \(([a-z_]+)\)$/;
const LOOKS_LIKE_TAG_HEADER = /[｜|]|[(（][a-z_]+[)）]$/;

export const parseTagHeader = (raw: string): ParsedHeader => {
  const header = raw.trim();
  if (header.startsWith('（暫緩）')) return { kind: 'deferred' };
  const match = TAG_HEADER.exec(header);
  if (match) return { kind: 'tag', slug: match[1] };
  return LOOKS_LIKE_TAG_HEADER.test(header) ? { kind: 'malformed' } : { kind: 'other' };
};

type ParsedCell = { ok: true; tag: Omit<VenueTag, 'slug'> | null } | { ok: false };

export const parseTagCell = (raw: string): ParsedCell => {
  const cell = raw.replace(/\s+/g, ' ').trim().replace(/^V/, 'v');
  if (cell === '') return { ok: true, tag: null };
  const match = /^v(?: (限期|\d{4}-\d{2}-\d{2}))?$/.exec(cell);
  if (!match) return { ok: false };
  const suffix = match[1];
  if (!suffix) return { ok: true, tag: {} };
  if (suffix === '限期') return { ok: true, tag: { limited: true } };
  return isValidCalendarDate(suffix)
    ? { ok: true, tag: { limited: true, until: suffix } }
    : { ok: false };
};

const EXTRA_COLUMNS = {
  原始說明連結: 'sourceLinks',
  店家提供的設備: 'equipmentNote',
  資料更新日期: 'infoUpdatedOn',
  檔期行事曆連結: 'calendarUrl',
} as const;
type ExtraField = (typeof EXTRA_COLUMNS)[keyof typeof EXTRA_COLUMNS];
const isExtraHeader = (h: string): h is keyof typeof EXTRA_COLUMNS => h in EXTRA_COLUMNS;

// Stops at whitespace and full-width punctuation (cells mix labels like「表單：」with URLs)
const URL_IN_TEXT = /https?:\/\/[^\s（）「」『』，。、；！？]+/g;
const MAX_URL_LENGTH = 500;
const MAX_SOURCE_LINKS = 5;
const MAX_EQUIPMENT_NOTE = 1000;

type ParsedExtra = { ok: true; value: unknown } | { ok: false; reason: string };

const parseExtra = (field: ExtraField, raw: string): ParsedExtra => {
  const cell = raw.trim();
  if (/^[?？]/.test(cell)) return { ok: false, reason: '開頭有 ?，代表預填未確認，確認後刪掉 ?' };
  switch (field) {
    case 'sourceLinks': {
      const links = (cell.match(URL_IN_TEXT) ?? []).map(u => u.replace(/[.,;:!?]+$/, ''));
      if (cell !== '' && links.length === 0) return { ok: false, reason: '沒有找到網址' };
      if (links.length > MAX_SOURCE_LINKS) {
        return { ok: false, reason: `最多 ${MAX_SOURCE_LINKS} 個連結，這格有 ${links.length} 個` };
      }
      if (links.some(u => u.length > MAX_URL_LENGTH))
        return { ok: false, reason: '網址超過 500 字' };
      return { ok: true, value: links };
    }
    case 'equipmentNote':
      return cell.length > MAX_EQUIPMENT_NOTE
        ? { ok: false, reason: `超過 ${MAX_EQUIPMENT_NOTE} 字` }
        : { ok: true, value: cell };
    case 'infoUpdatedOn':
      if (cell === '') return { ok: true, value: null };
      return isValidCalendarDate(cell)
        ? { ok: true, value: cell }
        : { ok: false, reason: '日期要是 YYYY-MM-DD，而且是真的日期' };
    case 'calendarUrl':
      if (cell === '') return { ok: true, value: null };
      return /^https?:\/\/\S+$/i.test(cell) && cell.length <= MAX_URL_LENGTH
        ? { ok: true, value: cell }
        : { ok: false, reason: '要是一個 http/https 網址' };
  }
};

// Tags that imply the venue can be decorated (requirements 決定 #5)
const DECOR_IMPLYING = new Set([
  ...VENUE_TAGS.filter(t => t.group === 'price').map(t => t.slug),
  'exhibition_space',
  'early_setup',
  'display_fixtures',
]);

const normalizeTag = (t: { slug: string; limited?: boolean; until?: string }): VenueTag => ({
  slug: t.slug,
  ...(t.limited === true ? { limited: true as const } : {}),
  ...(t.until ? { until: t.until } : {}),
});

const expiryText = (t: VenueTag) =>
  t.until ? `至 ${t.until}` : t.limited ? '限期（沒寫日期）' : '不限期';

const EXTRA_DEFAULTS: Record<ExtraField, unknown> = {
  sourceLinks: [],
  equipmentNote: '',
  infoUpdatedOn: null,
  calendarUrl: null,
};

const diffVenue = (
  tags: VenueTag[],
  extras: Partial<Record<ExtraField, unknown>>,
  current: ExistingVenueTagFields
): string[] => {
  const lines: string[] = [];
  const before = new Map((current.tags ?? []).map(t => [t.slug, normalizeTag(t)]));
  const after = new Map(tags.map(t => [t.slug, t]));

  for (const [slug, tag] of after) {
    const old = before.get(slug);
    if (!old) lines.push(`+ ${slug}${tag.limited ? `（${expiryText(tag)}）` : ''}`);
    else if (expiryText(old) !== expiryText(tag)) {
      lines.push(`~ ${slug}: ${expiryText(old)} → ${expiryText(tag)}`);
    }
  }
  for (const slug of before.keys()) if (!after.has(slug)) lines.push(`- ${slug}`);

  for (const [field, value] of Object.entries(extras) as [ExtraField, unknown][]) {
    const oldValue = current[field] ?? EXTRA_DEFAULTS[field];
    if (JSON.stringify(oldValue) !== JSON.stringify(value)) {
      lines.push(`~ ${field}: ${JSON.stringify(oldValue)} → ${JSON.stringify(value)}`);
    }
  }
  return lines;
};

export const buildImportPlan = (
  rows: string[][],
  existing: Map<string, ExistingVenueTagFields>
): ImportPlan => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const stats = { confirmed: 0, changed: 0, unchanged: 0, skipped: 0 };
  const headers = (rows[0] ?? []).map(h => h.trim());

  const dictionary = new Map(VENUE_TAGS.map(t => [t.slug, t]));
  const tagColumns: Array<{ col: number; slug: string; header: string }> = [];
  const extraColumns: Array<{ col: number; field: ExtraField; header: string }> = [];
  const seenSlugs = new Map<string, string>();
  const seenHeaders = new Set<string>();

  headers.forEach((header, col) => {
    const parsed = parseTagHeader(header);
    if (parsed.kind === 'deferred') return;
    if (parsed.kind === 'malformed') {
      errors.push(
        `表頭「${header}」：看起來是標籤欄，但格式不對（要像「價格｜免場地費 (free_venue)」）`
      );
      return;
    }
    if (parsed.kind === 'tag') {
      const def = dictionary.get(parsed.slug);
      if (!def || !def.active) {
        errors.push(`表頭「${header}」：${parsed.slug} 不在字典裡或已停用`);
      } else if (seenSlugs.has(parsed.slug)) {
        errors.push(`表頭「${header}」：${parsed.slug} 跟「${seenSlugs.get(parsed.slug)}」重複`);
      } else {
        seenSlugs.set(parsed.slug, header);
        tagColumns.push({ col, slug: parsed.slug, header });
      }
      return;
    }
    if (header === 'venue_id' || header === '整理狀態' || isExtraHeader(header)) {
      if (seenHeaders.has(header)) errors.push(`表頭「${header}」重複`);
      seenHeaders.add(header);
      if (isExtraHeader(header)) extraColumns.push({ col, field: EXTRA_COLUMNS[header], header });
    }
  });

  const idCol = headers.indexOf('venue_id');
  const statusCol = headers.indexOf('整理狀態');
  const nameCol = headers.indexOf('場地名稱');
  if (idCol < 0) errors.push('缺少 venue_id 欄');
  if (statusCol < 0) errors.push('缺少 整理狀態 欄');
  if (idCol < 0 || statusCol < 0) return { errors, warnings, changes: [], stats };

  for (const tag of VENUE_TAGS) {
    if (tag.active && !seenSlugs.has(tag.slug)) {
      warnings.push(
        `⚠️ 表上沒有 ${tag.slug}（${tag.label}）這一欄：commit 後，所有已確認場地的這個標籤都會被移除`
      );
    }
  }

  const changes: VenueTagChange[] = [];
  const idRows = new Map<string, number>();

  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    const cell = (col: number) => row[col] ?? '';
    if (row.every(c => (c ?? '').trim() === '')) return;
    if (cell(statusCol).trim() !== '已確認') {
      stats.skipped++;
      return;
    }
    stats.confirmed++;
    const rowErrors: string[] = [];
    const fail = (column: string, raw: string, reason: string) =>
      rowErrors.push(`第 ${rowNumber} 列｜${column}｜「${raw}」：${reason}`);

    const venueId = cell(idCol).trim();
    if (venueId === '') fail('venue_id', '', 'venue_id 空白');
    else if (idRows.has(venueId)) {
      fail('venue_id', venueId, `venue_id 在表上重複（第 ${idRows.get(venueId)} 列）`);
    } else if (!existing.has(venueId)) fail('venue_id', venueId, 'Firestore 找不到這個場地');
    if (venueId) idRows.set(venueId, idRows.get(venueId) ?? rowNumber);

    const tags: VenueTag[] = [];
    for (const { col, slug, header } of tagColumns) {
      const parsed = parseTagCell(cell(col));
      if (!parsed.ok) fail(header, cell(col), '格子只接受空白、v、v 限期、v YYYY-MM-DD');
      else if (parsed.tag) tags.push({ slug, ...parsed.tag });
    }
    const slugs = new Set(tags.map(t => t.slug));
    const decor = [...slugs].filter(s => DECOR_IMPLYING.has(s));
    if (decor.length > 0 && !slugs.has('can_decorate')) {
      fail('can_decorate', '', `有 ${decor.join('、')}，但 can_decorate 是空白`);
    }

    const extras: Partial<Record<ExtraField, unknown>> = {};
    for (const { col, field, header } of extraColumns) {
      const parsed = parseExtra(field, cell(col));
      if ('reason' in parsed) fail(header, cell(col), parsed.reason);
      else extras[field] = parsed.value;
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      return;
    }

    const current = existing.get(venueId)!;
    const lines = diffVenue(tags, extras, current);
    if (lines.length === 0) {
      stats.unchanged++;
      return;
    }
    stats.changed++;
    changes.push({
      venueId,
      rowNumber,
      name: (nameCol >= 0 ? cell(nameCol).trim() : '') || current.name || venueId,
      update: { tags, ...extras },
      lines,
    });
  });

  return { errors, warnings, changes: errors.length > 0 ? [] : changes, stats };
};
