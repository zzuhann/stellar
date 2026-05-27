/**
 * STELLAR venues KPI report builder (skeleton)
 *
 * 目的：
 * 1) 讀取後端 analyticsVenueEventsRaw（server-side 事件）
 * 2) 讀取 GA 匯出 CSV（前端事件）
 * 3) 產出每日 KPI 報表（CSV + Markdown）
 *
 * 使用方式（範例）：
 *   npx ts-node src/scripts/build-venue-kpi-report.ts --start=2026-05-01 --end=2026-05-28 --ga=./reports/venues/ga-export.csv
 *
 * GA CSV 欄位要求（最小）：
 * - date（YYYYMMDD）
 * - eventName
 * - eventCount
 * - contentId（可空）
 * - venueRegion（可空）
 */

import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { Timestamp } from 'firebase-admin/firestore';
import { db, hasFirebaseConfig } from '../config/firebase';

type ServerEventType = 'venue_list_served' | 'venue_detail_served';

interface CliOptions {
  start: string;
  end: string;
  gaCsvPath?: string;
}

interface GaCsvRow {
  date: string;
  eventName: string;
  eventCount: string;
  contentId?: string;
  venueRegion?: string;
}

interface DailyKpiRow {
  date: string;
  venueId: string;
  listServedCount: number;
  detailServedCount: number;
  listImpressionCount: number;
  detailClickCount: number;
  detailPageViewCount: number;
  contactClickCount: number;
  mapClickCount: number;
  filterEventCount: number;
  filterZeroResultCount: number;
  ctr: number;
  detailViewRate: number;
  contactConversionRate: number;
}

interface VenueDetailViewRank {
  venueId: string;
  detailServedCount: number;
}

type VenueDailyAccumulator = Omit<
  DailyKpiRow,
  'date' | 'venueId' | 'ctr' | 'detailViewRate' | 'contactConversionRate'
>;

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: Partial<CliOptions> = {};

  for (const arg of args) {
    if (arg.startsWith('--start=')) options.start = arg.replace('--start=', '');
    if (arg.startsWith('--end=')) options.end = arg.replace('--end=', '');
    if (arg.startsWith('--ga=')) options.gaCsvPath = arg.replace('--ga=', '');
  }

  if (!options.start || !options.end) {
    throw new Error('缺少必要參數：--start=YYYY-MM-DD --end=YYYY-MM-DD');
  }

  return options as CliOptions;
}

function parseDateAtStartOfDay(input: string): Date {
  const date = new Date(`${input}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`日期格式錯誤：${input}，請使用 YYYY-MM-DD`);
  }
  return date;
}

function formatDateYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function gaDateToYmd(gaDate: string): string {
  if (!gaDate || gaDate.length !== 8) return '';
  return `${gaDate.slice(0, 4)}-${gaDate.slice(4, 6)}-${gaDate.slice(6, 8)}`;
}

function getVenueIdFromContentId(contentId?: string): string {
  if (!contentId) return '';
  if (contentId.startsWith('venue_')) return contentId.replace('venue_', '');
  return contentId;
}

function toPercent(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function toCsv(rows: DailyKpiRow[]): string {
  const header = [
    'date',
    'venueId',
    'listServedCount',
    'detailServedCount',
    'listImpressionCount',
    'detailClickCount',
    'detailPageViewCount',
    'contactClickCount',
    'mapClickCount',
    'filterEventCount',
    'filterZeroResultCount',
    'ctr',
    'detailViewRate',
    'contactConversionRate',
  ].join(',');

  const lines = rows.map(row =>
    [
      row.date,
      row.venueId,
      row.listServedCount,
      row.detailServedCount,
      row.listImpressionCount,
      row.detailClickCount,
      row.detailPageViewCount,
      row.contactClickCount,
      row.mapClickCount,
      row.filterEventCount,
      row.filterZeroResultCount,
      row.ctr,
      row.detailViewRate,
      row.contactConversionRate,
    ].join(',')
  );

  return `${header}\n${lines.join('\n')}\n`;
}

async function readGaCsv(gaCsvPath: string): Promise<GaCsvRow[]> {
  return new Promise((resolve, reject) => {
    const rows: GaCsvRow[] = [];
    fs.createReadStream(gaCsvPath)
      .pipe(csv())
      .on('data', (row: GaCsvRow) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

function createEmptyAccumulator(): VenueDailyAccumulator {
  return {
    listServedCount: 0,
    detailServedCount: 0,
    listImpressionCount: 0,
    detailClickCount: 0,
    detailPageViewCount: 0,
    contactClickCount: 0,
    mapClickCount: 0,
    filterEventCount: 0,
    filterZeroResultCount: 0,
  };
}

function upsertAccumulator(
  bucket: Map<string, VenueDailyAccumulator>,
  date: string,
  venueId: string
): VenueDailyAccumulator {
  const key = `${date}:${venueId || 'all'}`;
  const existing = bucket.get(key);
  if (existing) return existing;

  const created = createEmptyAccumulator();
  bucket.set(key, created);
  return created;
}

async function collectServerEvents(
  startDate: Date,
  endDate: Date,
  bucket: Map<string, VenueDailyAccumulator>
): Promise<void> {
  if (!hasFirebaseConfig || !db) {
    console.warn('⚠️ Firebase 未設定，略過 server-side 事件收集');
    return;
  }

  const snapshot = await db
    .collection('analyticsVenueEventsRaw')
    .where('ts', '>=', Timestamp.fromDate(startDate))
    .where('ts', '<=', Timestamp.fromDate(endDate))
    .get();

  snapshot.forEach(doc => {
    const data = doc.data() as {
      event_type?: ServerEventType;
      metadata?: { venue_id?: string };
      ts?: Timestamp;
    };

    if (!data.ts || !data.event_type) return;

    const date = formatDateYmd(data.ts.toDate());
    const venueId = data.metadata?.venue_id ?? '';
    const acc = upsertAccumulator(bucket, date, venueId);

    if (data.event_type === 'venue_list_served') {
      acc.listServedCount += 1;
    } else if (data.event_type === 'venue_detail_served') {
      acc.detailServedCount += 1;
    }
  });
}

async function collectGaEvents(
  gaCsvPath: string | undefined,
  bucket: Map<string, VenueDailyAccumulator>
): Promise<void> {
  if (!gaCsvPath) {
    console.warn('⚠️ 未提供 --ga，略過 GA 匯出資料');
    return;
  }

  const rows = await readGaCsv(gaCsvPath);
  for (const row of rows) {
    const date = gaDateToYmd(row.date);
    if (!date) continue;

    const eventCount = Number(row.eventCount || 0);
    const venueId = getVenueIdFromContentId(row.contentId);
    const acc = upsertAccumulator(bucket, date, venueId);

    switch (row.eventName) {
      case 'view_venue_card':
        acc.listImpressionCount += eventCount;
        break;
      case 'click_venue_detail':
        acc.detailClickCount += eventCount;
        break;
      case 'page_view':
        if (venueId) acc.detailPageViewCount += eventCount;
        break;
      case 'click_venue_contact':
        acc.contactClickCount += eventCount;
        break;
      case 'click_venue_map':
        acc.mapClickCount += eventCount;
        break;
      case 'filter_venues':
        acc.filterEventCount += eventCount;
        // TODO: 若 GA 匯出包含 result_count，可在此計算 filterZeroResultCount
        break;
      default:
        break;
    }
  }
}

function buildDailyRows(bucket: Map<string, VenueDailyAccumulator>): DailyKpiRow[] {
  const rows: DailyKpiRow[] = [];

  for (const [key, value] of bucket.entries()) {
    const [date, venueId] = key.split(':');
    rows.push({
      date,
      venueId,
      ...value,
      ctr: toPercent(value.detailClickCount, value.listImpressionCount),
      detailViewRate: toPercent(value.detailPageViewCount, value.listServedCount),
      contactConversionRate: toPercent(value.contactClickCount, value.detailPageViewCount),
    });
  }

  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.venueId.localeCompare(b.venueId));
}

function buildTopDetailViews(rows: DailyKpiRow[], limit: number = 10): VenueDetailViewRank[] {
  const totalsByVenue = new Map<string, number>();

  for (const row of rows) {
    if (!row.venueId || row.venueId === 'all') continue;
    if (!row.detailServedCount) continue;

    totalsByVenue.set(row.venueId, (totalsByVenue.get(row.venueId) ?? 0) + row.detailServedCount);
  }

  return Array.from(totalsByVenue.entries())
    .map(([venueId, detailServedCount]) => ({ venueId, detailServedCount }))
    .sort((a, b) => b.detailServedCount - a.detailServedCount)
    .slice(0, limit);
}

function buildSummaryMarkdown(rows: DailyKpiRow[], start: string, end: string): string {
  const totals = rows.reduce(
    (acc, row) => {
      acc.listImpressionCount += row.listImpressionCount;
      acc.detailClickCount += row.detailClickCount;
      acc.detailPageViewCount += row.detailPageViewCount;
      acc.contactClickCount += row.contactClickCount;
      acc.mapClickCount += row.mapClickCount;
      return acc;
    },
    {
      listImpressionCount: 0,
      detailClickCount: 0,
      detailPageViewCount: 0,
      contactClickCount: 0,
      mapClickCount: 0,
    }
  );

  const ctr = toPercent(totals.detailClickCount, totals.listImpressionCount);
  const contactCvr = toPercent(totals.contactClickCount, totals.detailPageViewCount);
  const mapRate = toPercent(totals.mapClickCount, totals.detailPageViewCount);
  const topDetailViews = buildTopDetailViews(rows, 10);
  const topDetailViewsMd =
    topDetailViews.length === 0
      ? '- 無資料（請確認 analyticsVenueEventsRaw 是否有 `venue_detail_served`）'
      : topDetailViews
          .map(
            (item, index) =>
              `${index + 1}. venueId=${item.venueId}｜detail view times=${item.detailServedCount}`
          )
          .join('\n');

  return `# Venues KPI Summary (${start} ~ ${end})

## 核心指標
- 曝光（view_venue_card）：${totals.listImpressionCount}
- 點擊詳情（click_venue_detail）：${totals.detailClickCount}
- 列表 CTR：${ctr}%
- 詳情查看（page_view detail）：${totals.detailPageViewCount}
- 聯絡 CTA（click_venue_contact）：${totals.contactClickCount}
- 聯絡轉換率：${contactCvr}%
- 地圖導流率：${mapRate}%

## 詳情頁 View Times Top 10（server-side）
${topDetailViewsMd}

## 下一步（給 /analytics）
1. 比對本週與上週 CTR、contact 轉換率，找異常區段（region/capacity）。
2. 列出高曝光低轉換場地，提出內容與 CTA 優化假設。
3. 列出高 filter 需求但低供給區段，回饋 BD 補場地優先序。
`;
}

async function main(): Promise<void> {
  const options = parseArgs();
  const startDate = parseDateAtStartOfDay(options.start);
  const endDate = parseDateAtStartOfDay(options.end);
  endDate.setUTCHours(23, 59, 59, 999);

  const bucket = new Map<string, VenueDailyAccumulator>();
  await collectServerEvents(startDate, endDate, bucket);
  await collectGaEvents(options.gaCsvPath, bucket);

  const rows = buildDailyRows(bucket);
  const summary = buildSummaryMarkdown(rows, options.start, options.end);

  const outputDir = path.resolve(process.cwd(), 'reports/venues');
  await fs.promises.mkdir(outputDir, { recursive: true });

  const csvPath = path.join(outputDir, 'venue_kpi_daily.csv');
  const mdPath = path.join(outputDir, 'venue_kpi_summary.md');
  await fs.promises.writeFile(csvPath, toCsv(rows), 'utf-8');
  await fs.promises.writeFile(mdPath, summary, 'utf-8');

  console.warn(`✅ KPI CSV：${csvPath}`);
  console.warn(`✅ KPI Summary：${mdPath}`);
  console.warn(`📊 Rows: ${rows.length}`);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('❌ build-venue-kpi-report 失敗', error);
    process.exit(1);
  });
