import { isAddressPlaceId } from '../../src/utils/placeId';

describe('isAddressPlaceId', () => {
  it.each([
    ['ChIJN1t_tDeuEmsRUsoyG83frY4', false],
    ['EjHlj7DlkJvluILluILkuInlsLHljYAxM-W8teWFiOWwj-S4gQ', true],
    ['Ek3lj7DlkJvluILluILkuInlsLHljYAxM-W8teWFiOWwj-S4gQ', true],
    ['', true],
    ['GhIJQWDl0CIeQUARxks3icF8U8A', true],
    ['chij_lowercase_prefix', true],
  ])('%s -> %s', (id, expected) => {
    expect(isAddressPlaceId(id)).toBe(expected);
  });
});
