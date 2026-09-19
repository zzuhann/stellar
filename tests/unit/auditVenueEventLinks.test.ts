import {
  findDuplicatePlaceIds,
  findEventCountMismatches,
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
