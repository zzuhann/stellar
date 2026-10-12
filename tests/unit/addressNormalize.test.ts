import { isSameAddress, normalizeAddress } from '../../src/utils/addressNormalize';

const base = '台北市大安區忠孝東路四段1號';

describe('isSameAddress', () => {
  it.each([
    ['3 碼郵遞區號', `106${base}`, base],
    ['5 碼郵遞區號', `10647${base}`, base],
    ['台灣前綴', `台灣${base}`, base],
    ['臺灣前綴', `臺灣${base}`, base],
    ['Taiwan 前綴（大小寫不分）', `taiwan ${base}`, base],
    ['臺／台混用', '臺北市大安區忠孝東路四段1號', base],
    ['半形空白差異', '台北市 大安區 忠孝東路四段 1號', base],
    ['全形空白差異', '台北市　大安區　忠孝東路四段1號', base],
    ['全形數字', '台北市大安區忠孝東路四段１號', base],
    ['前綴在前、郵遞區號在後', `台灣106${base}`, base],
    ['郵遞區號在前、前綴在後', `106台灣${base}`, base],
    ['結尾台灣', `${base} 台灣`, base],
    ['結尾臺灣', `${base}臺灣`, base],
  ])('正規化後相同：%s', (_label, a, b) => {
    expect(isSameAddress(a, b)).toBe(true);
    expect(isSameAddress(b, a)).toBe(true);
  });

  it.each([
    ['不同門牌', '台北市大安區忠孝東路四段1號', '台北市大安區忠孝東路四段2號'],
    ['3F 與 3樓', '台北市大安區忠孝東路四段1號3F', '台北市大安區忠孝東路四段1號3樓'],
    ['不同路名', '台北市大安區忠孝東路四段1號', '台北市大安區仁愛路四段1號'],
  ])('實質不同：%s', (_label, a, b) => {
    expect(isSameAddress(a, b)).toBe(false);
  });

  it.each([
    ['左邊空字串', '', base],
    ['右邊空字串', base, ''],
    ['左邊僅空白', '  　 ', base],
    ['右邊僅空白', base, ' '],
    ['兩邊皆空', '', ''],
    ['兩邊皆僅空白', ' ', '　'],
    ['左邊 undefined', undefined, base],
    ['右邊 null', base, null],
  ])('空值一律視為不同：%s', (_label, a, b) => {
    expect(isSameAddress(a, b)).toBe(false);
  });
});

describe('normalizeAddress', () => {
  it('輸出已去除前綴、郵遞區號、空白並統一臺為台', () => {
    expect(normalizeAddress('106 臺灣 臺北市大安區')).toBe('台北市大安區');
  });

  it('空值回傳空字串', () => {
    expect(normalizeAddress(undefined)).toBe('');
    expect(normalizeAddress(null)).toBe('');
  });
});
