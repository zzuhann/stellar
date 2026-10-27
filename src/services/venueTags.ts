import { VENUE_TAGS } from '../constants/venueTags';
import {
  SuggestedVenueTag,
  VenueConditionAnswers,
  VenueEventTimeStatus,
  VenueTag,
} from '../models/types';
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

const feeTags = (fees: VenueConditionAnswers['fees']): VenueTag[] => {
  if (!fees) return [];
  const tags: VenueTag[] = [];
  if (fees.venueFee === 'free') {
    const limited = fees.freeVenueLimited === true || Boolean(fees.freeVenueUntil);
    tags.push({
      slug: 'free_venue',
      ...(limited ? { limited: true as const } : {}),
      ...(fees.freeVenueUntil ? { until: fees.freeVenueUntil } : {}),
    });
  } else if (fees.venueFee === 'paid') {
    tags.push({ slug: 'venue_fee' });
  } else if (fees.venueFee === 'depends') {
    // "Depends on the plan": some plans are free, so no limit applies
    tags.push({ slug: 'free_venue' }, { slug: 'venue_fee' });
  }
  if (fees.guarantee === 'yes') tags.push({ slug: 'needs_guarantee' });
  if (fees.guarantee === 'no') tags.push({ slug: 'no_min_guarantee' });
  if (fees.deposit === 'yes') tags.push({ slug: 'deposit' });
  return tags;
};

// Snapshot of store suggestions at submission time (design-backend.md §3.3); deduped by slug
export const mapAnswersToSuggestedTags = (answers: VenueConditionAnswers): SuggestedVenueTag[] => {
  const result: SuggestedVenueTag[] = [];
  const seen = new Set<string>();
  const add = (tag: VenueTag, source: SuggestedVenueTag['source']) => {
    if (seen.has(tag.slug)) return;
    seen.add(tag.slug);
    result.push({ ...tag, source });
  };

  answers.uses.options.forEach(slug => add({ slug }, 'store'));
  feeTags(answers.fees).forEach(tag => add(tag, 'store'));
  answers.services.options.forEach(slug => add({ slug }, 'store'));
  answers.spaceTypes.options.forEach(slug => add({ slug }, 'store'));
  (answers.equipment ?? []).forEach(slug => add({ slug }, 'store'));

  if (
    answers.services.options.includes('early_setup') ||
    (answers.equipment ?? []).includes('display_fixtures')
  ) {
    add({ slug: 'can_decorate' }, 'auto');
  }

  return result;
};
