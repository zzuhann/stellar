import { determineBackfillAction } from '../../src/scripts/backfill-venue-event-links';

describe('determineBackfillAction', () => {
  test('repairs the event when the venue already has its event reference', () => {
    expect(determineBackfillAction(true, undefined, 'venue-1')).toBe('repair-event');
  });

  test('skips only when both sides already point to each other', () => {
    expect(determineBackfillAction(true, 'venue-1', 'venue-1')).toBe('skip');
  });

  test('links both sides when the venue has no event reference', () => {
    expect(determineBackfillAction(false, undefined, 'venue-1')).toBe('link-both');
  });
});
