// STELLAR-curated venue tag dictionary. Slugs are permanent (they match the backfill sheet
// headers); labels may be renamed. See specs/features/venue-tags/design-backend.md §1.

export type VenueTagGroupKey = 'price' | 'service' | 'transport' | 'space' | 'equipment';

export interface VenueTagGroupDef {
  key: VenueTagGroupKey;
  label: string;
  order: number;
}

export interface VenueTagDef {
  slug: string;
  group: VenueTagGroupKey;
  label: string;
  order: number;
  // false = retired: hidden on read, rejected on write
  active: boolean;
  // Present only for tags allowed on cards; value is card priority (1 first)
  cardRank?: number;
}

export const VENUE_TAG_GROUPS: VenueTagGroupDef[] = [
  { key: 'price', label: '價格', order: 1 },
  { key: 'service', label: '服務', order: 2 },
  { key: 'transport', label: '交通', order: 3 },
  { key: 'space', label: '空間類型', order: 4 },
  { key: 'equipment', label: '設備', order: 5 },
];

export const VENUE_TAGS: VenueTagDef[] = [
  { slug: 'free_venue', group: 'price', label: '免場地費', order: 1, active: true, cardRank: 2 },
  {
    slug: 'no_min_guarantee',
    group: 'price',
    label: '無杯數門檻',
    order: 2,
    active: true,
    cardRank: 5,
  },
  { slug: 'needs_guarantee', group: 'price', label: '需保底', order: 3, active: true },
  { slug: 'venue_fee', group: 'price', label: '需場地費', order: 4, active: true },
  { slug: 'deposit', group: 'price', label: '需押金', order: 5, active: true },
  {
    slug: 'goods_distribution',
    group: 'service',
    label: '應援物代發',
    order: 1,
    active: true,
    cardRank: 1,
  },
  {
    slug: 'early_setup',
    group: 'service',
    label: '可提前佈展',
    order: 2,
    active: true,
    cardRank: 3,
  },
  {
    slug: 'beginner_friendly',
    group: 'service',
    label: '新手友善',
    order: 3,
    active: true,
    cardRank: 4,
  },
  {
    slug: 'parcel_receiving',
    group: 'service',
    label: '應援物代收',
    order: 4,
    active: true,
    cardRank: 6,
  },
  { slug: 'custom_menu', group: 'service', label: '客製餐點', order: 5, active: true, cardRank: 7 },
  {
    slug: 'private_booking',
    group: 'service',
    label: '可包場',
    order: 6,
    active: true,
    cardRank: 8,
  },
  { slug: 'can_decorate', group: 'service', label: '可佈置', order: 7, active: true },
  { slug: 'near_mrt', group: 'transport', label: '近捷運', order: 1, active: true },
  { slug: 'near_train', group: 'transport', label: '近火車站', order: 2, active: true },
  { slug: 'cafe', group: 'space', label: '咖啡廳', order: 1, active: true },
  {
    slug: 'exhibition_space',
    group: 'space',
    label: '展覽空間',
    order: 2,
    active: true,
    cardRank: 9,
  },
  { slug: 'bar', group: 'space', label: '酒吧/餐酒館', order: 3, active: true },
  {
    slug: 'multi_space',
    group: 'space',
    label: '多功能空間',
    order: 4,
    active: true,
    cardRank: 10,
  },
  { slug: 'takeaway_shop', group: 'space', label: '外帶為主', order: 5, active: true },
  { slug: 'projector', group: 'equipment', label: '投影/螢幕', order: 1, active: true },
  { slug: 'sound_system', group: 'equipment', label: '可播放音樂', order: 2, active: true },
  { slug: 'display_fixtures', group: 'equipment', label: '佈置設備', order: 3, active: true },
];
