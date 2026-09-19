import {
  findDuplicatePlaceIds,
  findEventCountMismatches,
  classifyEventVenueLink,
  VenueRecord,
} from '../../src/scripts/audit-venue-event-links';

describe('findDuplicatePlaceIds', () => {
  test('flags a placeId shared by two or more venues', () => {
    const result = findDuplicatePlaceIds([
      { id: 'v1', name: 'Venue A', placeId: 'ChIJ-shared' },
      { id: 'v2', name: 'Venue B', placeId: 'ChIJ-shared' },
      { id: 'v3', name: 'Venue C', placeId: 'ChIJ-unique' },
    ]);

    expect(result).toEqual([
      {
        placeId: 'ChIJ-shared',
        venues: [
          { id: 'v1', name: 'Venue A' },
          { id: 'v2', name: 'Venue B' },
        ],
      },
    ]);
  });

  test('ignores venues without a placeId', () => {
    const result = findDuplicatePlaceIds([
      { id: 'v1', name: 'Venue A' },
      { id: 'v2', name: 'Venue B' },
    ]);

    expect(result).toEqual([]);
  });

  test('returns an empty array when every placeId is unique', () => {
    const result = findDuplicatePlaceIds([
      { id: 'v1', name: 'Venue A', placeId: 'ChIJ-a' },
      { id: 'v2', name: 'Venue B', placeId: 'ChIJ-b' },
    ]);

    expect(result).toEqual([]);
  });
});

describe('findEventCountMismatches', () => {
  test('flags a venue whose eventCount does not match its eventRefs length', () => {
    const result = findEventCountMismatches([
      { id: 'v1', name: 'Venue A', eventCount: 3, eventRefsLength: 2 },
    ]);

    expect(result).toEqual([
      { venueId: 'v1', venueName: 'Venue A', recordedEventCount: 3, actualEventRefsLength: 2 },
    ]);
  });

  test('does not flag a venue whose eventCount matches its eventRefs length', () => {
    const result = findEventCountMismatches([
      { id: 'v1', name: 'Venue A', eventCount: 2, eventRefsLength: 2 },
    ]);

    expect(result).toEqual([]);
  });

  test('handles venues with zero events consistently', () => {
    const result = findEventCountMismatches([
      { id: 'v1', name: 'Venue A', eventCount: 0, eventRefsLength: 0 },
    ]);

    expect(result).toEqual([]);
  });
});

describe('classifyEventVenueLink', () => {
  function buildLookups(records: VenueRecord[]) {
    const venuesById = new Map(records.map(v => [v.id, v]));
    const venuesByPlaceId = new Map<string, VenueRecord[]>();
    for (const v of records) {
      if (!v.placeId) continue;
      const list = venuesByPlaceId.get(v.placeId) ?? [];
      list.push(v);
      venuesByPlaceId.set(v.placeId, list);
    }
    return { venuesById, venuesByPlaceId };
  }

  test('reports already-correctly-linked event as skip even when its placeId is shared by another venue', () => {
    // Regression for the bug Codex found: v1 and v2 share the same placeId, and event
    // `e` is already correctly bidirectionally linked to v2. The audit must not fall back
    // to v1 (the first entry for that placeId) and misreport this as unlinked.
    const v1: VenueRecord = { id: 'v1', name: 'Venue A', placeId: 'shared', eventRefIds: [] };
    const v2: VenueRecord = { id: 'v2', name: 'Venue B', placeId: 'shared', eventRefIds: ['e'] };
    const { venuesById, venuesByPlaceId } = buildLookups([v1, v2]);

    const result = classifyEventVenueLink(
      { eventId: 'e', placeId: 'shared', linkedVenueId: 'v2' },
      venuesById,
      venuesByPlaceId
    );

    expect(result).toEqual({ status: 'skip', targetVenueId: 'v2' });
  });

  test('flags an unlinked event under a duplicate placeId group as ambiguous instead of guessing', () => {
    const v1: VenueRecord = { id: 'v1', name: 'Venue A', placeId: 'shared', eventRefIds: [] };
    const v2: VenueRecord = { id: 'v2', name: 'Venue B', placeId: 'shared', eventRefIds: [] };
    const { venuesById, venuesByPlaceId } = buildLookups([v1, v2]);

    const result = classifyEventVenueLink(
      { eventId: 'e', placeId: 'shared', linkedVenueId: undefined },
      venuesById,
      venuesByPlaceId
    );

    expect(result).toEqual({ status: 'ambiguous-duplicate-placeid' });
  });

  test('flags an event whose venueId points to a venue with a mismatched placeId', () => {
    const v1: VenueRecord = { id: 'v1', name: 'Venue A', placeId: 'other', eventRefIds: [] };
    const { venuesById, venuesByPlaceId } = buildLookups([v1]);

    const result = classifyEventVenueLink(
      { eventId: 'e', placeId: 'shared', linkedVenueId: 'v1' },
      venuesById,
      venuesByPlaceId
    );

    expect(result).toEqual({ status: 'inconsistent-venue-link' });
  });

  test('flags an event whose venueId points to a nonexistent venue', () => {
    const { venuesById, venuesByPlaceId } = buildLookups([]);

    const result = classifyEventVenueLink(
      { eventId: 'e', placeId: 'shared', linkedVenueId: 'missing' },
      venuesById,
      venuesByPlaceId
    );

    expect(result).toEqual({ status: 'inconsistent-venue-link' });
  });

  test('reports no-matching-venue when placeId matches no venue', () => {
    const { venuesById, venuesByPlaceId } = buildLookups([]);

    const result = classifyEventVenueLink(
      { eventId: 'e', placeId: 'unknown', linkedVenueId: undefined },
      venuesById,
      venuesByPlaceId
    );

    expect(result).toEqual({ status: 'no-matching-venue' });
  });

  test('reports repair-event when the venue already has the ref but the event lacks venueId', () => {
    const v1: VenueRecord = { id: 'v1', name: 'Venue A', placeId: 'unique', eventRefIds: ['e'] };
    const { venuesById, venuesByPlaceId } = buildLookups([v1]);

    const result = classifyEventVenueLink(
      { eventId: 'e', placeId: 'unique', linkedVenueId: undefined },
      venuesById,
      venuesByPlaceId
    );

    expect(result).toEqual({ status: 'repair-event', targetVenueId: 'v1' });
  });

  test('reports link-both when neither side is linked and the placeId is unique', () => {
    const v1: VenueRecord = { id: 'v1', name: 'Venue A', placeId: 'unique', eventRefIds: [] };
    const { venuesById, venuesByPlaceId } = buildLookups([v1]);

    const result = classifyEventVenueLink(
      { eventId: 'e', placeId: 'unique', linkedVenueId: undefined },
      venuesById,
      venuesByPlaceId
    );

    expect(result).toEqual({ status: 'link-both', targetVenueId: 'v1' });
  });
});
