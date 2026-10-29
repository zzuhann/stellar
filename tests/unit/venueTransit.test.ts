import { pickLegacyTransit } from '../../src/services/venueTransit';
import { TransitStop } from '../../src/models/types';

describe('pickLegacyTransit（design-backend §10.3）', () => {
  const s = (type: TransitStop['type'], station: string, walkMinutes: number | null) => ({
    type,
    station,
    walkMinutes,
  });

  it.each([
    [
      '倒序輸入（公車在前、捷運在後）→ 回寫捷運那筆',
      [s('bus', '復興新和街口', 3), s('mrt', '中山', 5)],
      { nearestMrt: '中山', mrtWalkMinutes: 5 },
    ],
    [
      '只有公車 5 分鐘 → 加類型字',
      [s('bus', '復興新和街口', 5)],
      { nearestMrt: '公車 復興新和街口', mrtWalkMinutes: 5 },
    ],
    [
      '同類型兩筆取陣列第一筆',
      [s('mrt', '中山', 5), s('mrt', '雙連', 2)],
      { nearestMrt: '中山', mrtWalkMinutes: 5 },
    ],
    [
      '優先序：輕軌 > 火車 > 高鐵 > 公車',
      [
        s('bus', '市政府', 1),
        s('hsr', '台中', 2),
        s('train', '新烏日', 3),
        s('light_rail', '凱旋武昌', 4),
      ],
      { nearestMrt: '輕軌 凱旋武昌', mrtWalkMinutes: 4 },
    ],
    [
      '火車優先於高鐵',
      [s('hsr', '台中', 2), s('train', '新烏日', 3)],
      { nearestMrt: '火車 新烏日', mrtWalkMinutes: 3 },
    ],
    ['高鐵', [s('hsr', '台中', null)], { nearestMrt: '高鐵 台中', mrtWalkMinutes: null }],
    [
      'station 已含類型字不重複加',
      [s('train', '台中火車站', 8)],
      { nearestMrt: '台中火車站', mrtWalkMinutes: 8 },
    ],
    [
      '高鐵站名已含高鐵',
      [s('hsr', '高鐵台中站', 6)],
      { nearestMrt: '高鐵台中站', mrtWalkMinutes: 6 },
    ],
    [
      'walkMinutes 0 保留 0',
      [s('bus', '市政府', 0)],
      { nearestMrt: '公車 市政府', mrtWalkMinutes: 0 },
    ],
    ['[] → 清空', [], { nearestMrt: '', mrtWalkMinutes: null }],
    [
      '加類型字後超過舊欄位上限 100 字 → 截到 100 字',
      [s('bus', 'a'.repeat(100), 2)],
      { nearestMrt: `公車 ${'a'.repeat(97)}`, mrtWalkMinutes: 2 },
    ],
  ])('%s', (_name, stops, expected) => {
    expect(pickLegacyTransit(stops as TransitStop[])).toEqual(expected);
  });
});
