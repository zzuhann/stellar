import { TransitStop, TransitType } from '../models/types';

// Legacy pages show nearestMrt behind a metro icon, so non-metro stations carry their type word
const TRANSIT_PRIORITY: TransitType[] = ['mrt', 'light_rail', 'train', 'hsr', 'bus'];
const LEGACY_NEAREST_MRT_MAX = 100; // same cap as the nearestMrt schema

const TYPE_PREFIX: Record<TransitType, string> = {
  mrt: '',
  light_rail: '輕軌',
  train: '火車',
  hsr: '高鐵',
  bus: '公車',
};

// Derives the legacy nearestMrt / mrtWalkMinutes from transitStops (design-backend.md §10.3)
export const pickLegacyTransit = (
  stops: TransitStop[]
): { nearestMrt: string; mrtWalkMinutes: number | null } => {
  for (const type of TRANSIT_PRIORITY) {
    const stop = stops.find(s => s.type === type);
    if (!stop) continue;
    const prefix = TYPE_PREFIX[type];
    const nearestMrt =
      prefix && !stop.station.includes(prefix) ? `${prefix} ${stop.station}` : stop.station;
    return {
      nearestMrt: nearestMrt.slice(0, LEGACY_NEAREST_MRT_MAX),
      mrtWalkMinutes: stop.walkMinutes,
    };
  }
  return { nearestMrt: '', mrtWalkMinutes: null };
};
