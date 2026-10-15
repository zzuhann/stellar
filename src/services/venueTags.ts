import { VENUE_TAGS } from '../constants/venueTags';
import { VenueEventTimeStatus, VenueTag } from '../models/types';
import { getTaipeiDateString } from '../utils/taipeiDate';

const activeSlugs = new Set(VENUE_TAGS.filter(t => t.active).map(t => t.slug));

export const isActiveTagSlug = (slug: string): boolean => activeSlugs.has(slug);

// Dates are YYYY-MM-DD so string comparison is date comparison; `until` day itself still shows.
export const filterVisibleTags = (tags: VenueTag[] | undefined, today: string): VenueTag[] =>
  (tags ?? []).filter(t => isActiveTagSlug(t.slug) && (!t.until || t.until >= today));

export const computeEventTimeStatus = (
  startIso: string,
  endIso: string,
  today: string
): VenueEventTimeStatus => {
  if (!startIso || !endIso) return null;
  const start = getTaipeiDateString(new Date(startIso));
  const end = getTaipeiDateString(new Date(endIso));
  if (today < start) return 'upcoming';
  if (today > end) return 'ended';
  return 'ongoing';
};
