import { z } from 'zod';
import { fetchWithRetry } from '../controllers/placesController';
import { resolveLocation, ParsedLocation } from './placesService';

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// 已依 requirements.md／design-backend.md 的抽取要求撰寫，涵蓋：
// - 無法可靠判斷的欄位回 null，不猜測、不捏造
// - 沒寫結束日期時 eventDateEnd 回 null，不假設等於開始日期
// - 明確區分「店家營業時間」與「活動時段」
// - 日期沒寫年份時，依提供的今天日期推算正確年份
// - 地址只取地址本體，不混入方向指引文字（例如捷運 X 號出口）
const EXTRACTION_PROMPT = `你是專門從台灣 Instagram／Threads 生日應援咖啡廳貼文中抽取活動資訊的助手。
請閱讀下方貼文文案，抽取以下欄位，並嚴格依照指定的 JSON 結構回傳：

- title：活動標題
- artistName：貼文提到的藝人／偶像名字（僅供人工參考，不用做比對）
- eventDateStart：活動開始日期，格式 YYYY-MM-DD
- eventDateEnd：活動結束日期，格式 YYYY-MM-DD；貼文沒有明確寫結束日期時回傳 null，不要假設等於開始日期
- timeStart：活動當天的開始時段，格式 HH:mm（24 小時制）
- timeEnd：活動當天的結束時段，格式 HH:mm（24 小時制）
- locationName：店名
- locationAddress：地址本體，只取地址文字，不要包含捷運站、出口、地標等方向指引文字
- socialHandles：貼文中出現的社群帳號，格式為 "平台:帳號"（例如 "instagram:@example"、"threads:@example"），平台只用 instagram 或 threads
- redemptionCondition：兌換／領取活動贈品或服務的條件（例如「消費飲品即可兌換小卡」）

重要規則：
1. 任何欄位如果無法從文案可靠判斷，一律回傳 null（socialHandles 找不到則回傳空陣列），絕對不要猜測或捏造內容。
2. 務必區分「店家一般營業時間」與「活動當天的特定時段」：只有貼文明確標示這是應援活動當天的時段才填入 timeStart／timeEnd，一般營業時間不算活動時段，此時回 null。
3. 若日期沒有寫年份（例如「8/1(六)」），請依下方提供的「今天日期」推算合理的年份（優先假設是今天之後最接近的日期）。
4. locationAddress 只填地址本體，不要混入「捷運 OO 站 X 號出口」之類的到達方式說明文字。
5. 只回傳 JSON，不要有其他文字說明。`;

const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING', nullable: true },
    artistName: { type: 'STRING', nullable: true },
    eventDateStart: { type: 'STRING', nullable: true },
    eventDateEnd: { type: 'STRING', nullable: true },
    timeStart: { type: 'STRING', nullable: true },
    timeEnd: { type: 'STRING', nullable: true },
    locationName: { type: 'STRING', nullable: true },
    locationAddress: { type: 'STRING', nullable: true },
    socialHandles: { type: 'ARRAY', items: { type: 'STRING' } },
    redemptionCondition: { type: 'STRING', nullable: true },
  },
  required: [
    'title',
    'artistName',
    'eventDateStart',
    'eventDateEnd',
    'timeStart',
    'timeEnd',
    'locationName',
    'locationAddress',
    'socialHandles',
    'redemptionCondition',
  ],
};

// Gemini 原始回傳結構，僅用於呼叫後的 Zod 驗證，不對外曝露。
// 即使 responseSchema 已強制 Gemini 回傳符合結構的 JSON，仍在後端再驗證一次作為防禦層。
const geminiExtractionSchema = z.object({
  title: z.string().nullable(),
  artistName: z.string().nullable(),
  eventDateStart: z.string().nullable(),
  eventDateEnd: z.string().nullable(),
  timeStart: z.string().nullable(),
  timeEnd: z.string().nullable(),
  locationName: z.string().nullable(),
  locationAddress: z.string().nullable(),
  socialHandles: z.array(z.string()),
  redemptionCondition: z.string().nullable(),
});

type GeminiExtraction = z.infer<typeof geminiExtractionSchema>;

export type ParseCaptionReason = 'quota_exceeded' | 'gemini_unavailable' | 'parse_failed';

export interface ParsedCaptionFields {
  title: string | null;
  artistName: string | null;
  eventDateStart: string | null;
  eventDateEnd: string | null;
  timeStart: string | null;
  timeEnd: string | null;
  location: ParsedLocation | null;
  socialMedia: { instagram?: string; threads?: string } | null;
  redemptionCondition: string | null;
}

export interface ParsedCaptionResult {
  success: boolean;
  reason?: ParseCaptionReason;
  message?: string;
  parsed?: ParsedCaptionFields;
}

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
const TIME_FORMAT = /^([01]\d|2[0-3]):([0-5]\d)$/;

function isValidCalendarDate(dateStr: string): boolean {
  if (!DATE_FORMAT.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * 欄位層級的合理性檢查：單一欄位格式怪異就把該欄位丟回 null，不整包拒絕。
 * 每次有欄位被丟回 null 都記 log，作為試點期間觀察 Gemini 抽取品質的依據。
 */
function sanitizeDates(
  eventDateStart: string | null,
  eventDateEnd: string | null
): { eventDateStart: string | null; eventDateEnd: string | null } {
  let start = eventDateStart;
  let end = eventDateEnd;

  if (start !== null && !isValidCalendarDate(start)) {
    console.warn('parse-caption: eventDateStart 格式不符，丟回 null', { value: start });
    start = null;
  }
  if (end !== null && !isValidCalendarDate(end)) {
    console.warn('parse-caption: eventDateEnd 格式不符，丟回 null', { value: end });
    end = null;
  }
  if (start !== null && end !== null && end < start) {
    console.warn('parse-caption: eventDateEnd 早於 eventDateStart，丟回 null', {
      eventDateStart: start,
      eventDateEnd: end,
    });
    end = null;
  }

  return { eventDateStart: start, eventDateEnd: end };
}

function sanitizeTime(field: 'timeStart' | 'timeEnd', value: string | null): string | null {
  if (value === null || TIME_FORMAT.test(value)) return value;
  console.warn(`parse-caption: ${field} 格式不符，丟回 null`, { value });
  return null;
}

function parseSocialHandles(
  handles: string[]
): { instagram?: string; threads?: string } | null {
  const result: { instagram?: string; threads?: string } = {};

  for (const raw of handles) {
    const separatorIndex = raw.indexOf(':');
    if (separatorIndex === -1) continue;

    const platform = raw.slice(0, separatorIndex).trim().toLowerCase();
    const handle = raw.slice(separatorIndex + 1).trim();
    if (!handle) continue;

    if (platform === 'instagram') result.instagram = handle;
    else if (platform === 'threads') result.threads = handle;
  }

  return Object.keys(result).length > 0 ? result : null;
}

async function callGemini(caption: string): Promise<globalThis.Response> {
  const apiKey = process.env.GEMINI_API_KEY;
  const today = new Date().toISOString().slice(0, 10);

  return fetchWithRetry(
    `${GEMINI_ENDPOINT}?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { parts: [{ text: `${EXTRACTION_PROMPT}\n\n今天日期：${today}\n\n貼文文案：\n${caption}` }] },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: GEMINI_RESPONSE_SCHEMA,
        },
      }),
    },
    { timeoutMs: 15000, maxAttempts: 2, delayMs: 500 }
  );
}

async function buildParsedFields(extraction: GeminiExtraction): Promise<ParsedCaptionFields> {
  const { eventDateStart, eventDateEnd } = sanitizeDates(
    extraction.eventDateStart,
    extraction.eventDateEnd
  );
  const timeStart = sanitizeTime('timeStart', extraction.timeStart);
  const timeEnd = sanitizeTime('timeEnd', extraction.timeEnd);

  const locationText = [extraction.locationName, extraction.locationAddress]
    .filter(Boolean)
    .join(' ')
    .trim();
  const location = locationText ? await resolveLocation(locationText) : null;

  const socialMedia = parseSocialHandles(extraction.socialHandles);

  return {
    title: extraction.title,
    artistName: extraction.artistName,
    eventDateStart,
    eventDateEnd,
    timeStart,
    timeEnd,
    location,
    socialMedia,
    redemptionCondition: extraction.redemptionCondition,
  };
}

export class ImportService {
  /**
   * 呼叫 Gemini 結構化解析貼文文案，無狀態，不寫入任何資料庫。
   * 呼叫端（controller）需先確認 GEMINI_API_KEY 已設定（未設定回 503，不是這個 method 的職責）。
   */
  async parseCaption(caption: string): Promise<ParsedCaptionResult> {
    let geminiResponse: globalThis.Response;
    try {
      geminiResponse = await callGemini(caption);
    } catch (error) {
      console.warn('Gemini API 網路層呼叫失敗:', error);
      return {
        success: false,
        reason: 'gemini_unavailable',
        message: 'AI 服務暫時無法使用，請稍後再試或手動填寫',
      };
    }

    if (!geminiResponse.ok) {
      if (geminiResponse.status === 429) {
        return {
          success: false,
          reason: 'quota_exceeded',
          message: 'AI 解析額度已用完，請手動填寫',
        };
      }
      console.warn('Gemini API 回傳非預期狀態碼:', geminiResponse.status);
      return {
        success: false,
        reason: 'gemini_unavailable',
        message: 'AI 服務暫時無法使用，請稍後再試或手動填寫',
      };
    }

    let rawText: string;
    try {
      const body = await geminiResponse.json();
      const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== 'string') {
        throw new Error('Gemini 回應缺少可解析的文字內容');
      }
      rawText = text;
    } catch (error) {
      console.warn('Gemini API 回應格式不符預期:', error);
      return {
        success: false,
        reason: 'parse_failed',
        message: 'AI 無法解析這段文案，請手動填寫',
      };
    }

    let extraction: GeminiExtraction;
    try {
      const jsonCandidate = JSON.parse(rawText);
      const result = geminiExtractionSchema.safeParse(jsonCandidate);
      if (!result.success) {
        console.warn('Gemini 回應不符合預期 schema:', {
          issues: result.error.issues,
          rawTextPreview: rawText.slice(0, 500),
        });
        return {
          success: false,
          reason: 'parse_failed',
          message: 'AI 無法解析這段文案，請手動填寫',
        };
      }
      extraction = result.data;
    } catch (error) {
      console.warn('Gemini 回應不是合法 JSON:', {
        error,
        rawTextPreview: rawText.slice(0, 500),
      });
      return {
        success: false,
        reason: 'parse_failed',
        message: 'AI 無法解析這段文案，請手動填寫',
      };
    }

    const parsed = await buildParsedFields(extraction);
    return { success: true, parsed };
  }
}
