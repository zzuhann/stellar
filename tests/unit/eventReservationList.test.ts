import { EventService } from '../../src/services/eventService';

jest.mock('../../src/config/firebase', () => ({
  hasFirebaseConfig: true,
  db: { collection: jest.fn(() => ({})) },
}));

const NOW = new Date('2026-11-20T04:00:00Z').getTime();
const HOUR = 3600 * 1000;

const ts = (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) });

type Overrides = Record<string, unknown>;

// Base item as returned by getApprovedActiveEventsBase (email already stripped).
const makeEvent = (id: string, o: Overrides = {}) => ({
  id,
  slug: `slug-${id}`,
  title: `Event ${id}`,
  status: 'approved',
  artists: [{ id: 'a1', name: 'Artist', slug: 'artist' }],
  datetime: { start: ts(NOW + 24 * HOUR), end: ts(NOW + 48 * HOUR) },
  reservation: { url: 'https://example.com/book' },
  ...o,
});

let service: EventService;
const setBase = (events: unknown[]) =>
  jest
    .spyOn(EventService.prototype, 'getApprovedActiveEventsBase')
    .mockResolvedValue(events as never);

const idsOf = async () => (await service.getReservationEvents()).map(e => e.id);

describe('EventService.getReservationEvents', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    service = new EventService();
  });

  // TC-004
  test.each<[string, Overrides, boolean]>([
    ['approved, end in future, url set', {}, true],
    ['url is empty string', { reservation: { url: '' } }, false],
    ['url is whitespace only', { reservation: { url: '   ' } }, false],
    ['url has surrounding spaces but content', { reservation: { url: ' https://x ' } }, true],
    ['only startAt, no url', { reservation: { startAt: ts(NOW + HOUR) } }, false],
    ['no reservation field', { reservation: undefined }, false],
    [
      'end just passed (now - 1ms)',
      { datetime: { start: ts(NOW - 5 * HOUR), end: ts(NOW - 1) } },
      false,
    ],
    ['end equals now', { datetime: { start: ts(NOW - 5 * HOUR), end: ts(NOW) } }, false],
    ['status pending', { status: 'pending' }, false],
    ['status rejected', { status: 'rejected' }, false],
  ])('inclusion: %s', async (_name, overrides, included) => {
    setBase([makeEvent('x', overrides)]);
    expect(await idsOf()).toEqual(included ? ['x'] : []);
  });

  // TC-005
  describe('ordering', () => {
    const start = (offsetH: number) => ({
      start: ts(NOW + offsetH * HOUR),
      end: ts(NOW + (offsetH + 24) * HOUR),
    });

    test('upcoming first by startAt asc, then unset', async () => {
      setBase([
        makeEvent('C', { datetime: start(-10) }),
        makeEvent('B', { reservation: { url: 'u', startAt: ts(NOW + 2 * HOUR) } }),
        makeEvent('A', { reservation: { url: 'u', startAt: ts(NOW + HOUR) } }),
      ]);
      expect(await idsOf()).toEqual(['A', 'B', 'C']);
    });

    test('same startAt: earlier datetime.start first', async () => {
      const r = { url: 'u', startAt: ts(NOW + HOUR) };
      setBase([
        makeEvent('late', { reservation: r, datetime: start(30) }),
        makeEvent('early', { reservation: r, datetime: start(10) }),
      ]);
      expect(await idsOf()).toEqual(['early', 'late']);
    });

    test('same startAt and start: id asc', async () => {
      const r = { url: 'u', startAt: ts(NOW + HOUR) };
      setBase([
        makeEvent('b', { reservation: r }),
        makeEvent('a', { reservation: r }),
        makeEvent('c', { reservation: r }),
      ]);
      expect(await idsOf()).toEqual(['a', 'b', 'c']);
    });

    test('startAt == now is not upcoming; both go to opened group by start asc', async () => {
      setBase([
        makeEvent('E', { reservation: { url: 'u', startAt: ts(NOW - HOUR) }, datetime: start(20) }),
        makeEvent('D', { reservation: { url: 'u', startAt: ts(NOW) }, datetime: start(10) }),
        makeEvent('U', { reservation: { url: 'u', startAt: ts(NOW + HOUR) }, datetime: start(50) }),
      ]);
      expect(await idsOf()).toEqual(['U', 'D', 'E']);
    });

    test('opened group: ongoing (past start) before not-yet-started', async () => {
      setBase([
        makeEvent('future', { datetime: start(5) }),
        makeEvent('ongoing', { datetime: { start: ts(NOW - 5 * HOUR), end: ts(NOW + HOUR) } }),
      ]);
      expect(await idsOf()).toEqual(['ongoing', 'future']);
    });
  });

  // TC-006
  describe('20 item cap', () => {
    const upcoming = (id: string, i: number) =>
      makeEvent(id, { reservation: { url: 'u', startAt: ts(NOW + (i + 1) * HOUR) } });
    const opened = (id: string, i: number) =>
      makeEvent(id, { datetime: { start: ts(NOW + (i + 1) * HOUR), end: ts(NOW + 100 * HOUR) } });

    test('25 eligible with 3 upcoming: 20 returned, upcoming first', async () => {
      setBase([
        ...Array.from({ length: 22 }, (_, i) => opened(`o${String(i).padStart(2, '0')}`, i)),
        ...Array.from({ length: 3 }, (_, i) => upcoming(`u${i}`, i)),
      ]);
      const ids = await idsOf();
      expect(ids).toHaveLength(20);
      expect(ids.slice(0, 3)).toEqual(['u0', 'u1', 'u2']);
    });

    test('22 upcoming + 5 opened: only upcoming returned', async () => {
      setBase([
        ...Array.from({ length: 5 }, (_, i) => opened(`o${i}`, i)),
        ...Array.from({ length: 22 }, (_, i) => upcoming(`u${String(i).padStart(2, '0')}`, i)),
      ]);
      const ids = await idsOf();
      expect(ids).toHaveLength(20);
      expect(ids.every(id => id.startsWith('u'))).toBe(true);
    });
  });

  // TC-024
  test.each([
    ['string', 'not-a-date'],
    ['object without toMillis', { _seconds: 1 }],
  ])('malformed startAt (%s) is included in the opened group without throwing', async (_n, bad) => {
    setBase([
      makeEvent('bad', { reservation: { url: 'u', startAt: bad } }),
      makeEvent('up', { reservation: { url: 'u', startAt: ts(NOW + HOUR) } }),
    ]);
    expect(await idsOf()).toEqual(['up', 'bad']);
  });
});
