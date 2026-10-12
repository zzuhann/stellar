// Prefix is an empirical rule (shop IDs start with ChIJ), not a Google contract
export const isAddressPlaceId = (placeId: string): boolean => !placeId.startsWith('ChIJ');
