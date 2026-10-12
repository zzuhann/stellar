import { DocumentReference, FieldValue, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { db } from '../config/firebase';
import { AppError } from '../utils/AppError';
import { cache } from '../utils/cache';
import { isSameAddress } from '../utils/addressNormalize';
import { isAddressPlaceId } from '../utils/placeId';
import { fetchPlaceInfo } from './googlePlacesService';

export type AddressChoice = 'existing' | 'google';

interface LinkableEvent {
  id: string;
  title: string;
}

interface LinkableCandidate extends LinkableEvent {
  ref: DocumentReference;
}

const MAX_LINKABLE_EVENTS = 400;
const PREVIEW_LIST_LIMIT = 100;

function requireDb() {
  if (!db) throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Firebase unavailable');
  return db;
}

const venuesByPlaceId = (placeId: string) =>
  requireDb().collection('venues').where('placeId', '==', placeId).limit(2);

const eventsByPlaceId = (placeId: string) =>
  requireDb().collection('coffeeEvents').where('location.placeId', '==', placeId);

function assertPlaceIdFree(docs: QueryDocumentSnapshot[], venueId: string) {
  const other = docs.find(doc => doc.id !== venueId);
  if (!other) return;
  throw new AppError(
    409,
    'PLACE_ID_IN_USE',
    'Place ID is already used by another venue',
    undefined,
    { venue: { id: other.id, name: other.data().name } }
  );
}

// Shared by preview and apply; venueId may be missing or deleted, so it is filtered in memory
function collectLinkable(docs: QueryDocumentSnapshot[]): LinkableCandidate[] {
  return docs
    .filter(doc => {
      const data = doc.data();
      return data.status === 'approved' && !data.location?.venueId;
    })
    .map(doc => ({ id: doc.id, title: doc.data().title ?? '', ref: doc.ref }));
}

function assertWithinLimit(count: number) {
  if (count <= MAX_LINKABLE_EVENTS) return;
  throw new AppError(422, 'TOO_MANY_LINKABLE_EVENTS', 'Too many linkable events', undefined, {
    linkableEventCount: count,
  });
}

function compareAddress(venueAddress: unknown, googleAddress: string) {
  const current = typeof venueAddress === 'string' ? venueAddress : '';
  const currentEmpty = current.trim() === '';
  const googleEmpty = googleAddress.trim() === '';
  const same = isSameAddress(current, googleAddress);
  return {
    current,
    currentEmpty,
    googleEmpty,
    same,
    choiceRequired: !same && !currentEmpty && !googleEmpty,
  };
}

function pickAddress(
  comparison: ReturnType<typeof compareAddress>,
  googleAddress: string,
  choice?: AddressChoice
): { address: string; write: boolean } {
  // Never overwrite the address with an empty Google value
  if (comparison.googleEmpty) {
    return { address: comparison.currentEmpty ? '' : comparison.current, write: false };
  }
  if (comparison.currentEmpty) return { address: googleAddress, write: true };
  if (comparison.same) return { address: comparison.current, write: false };
  if (!choice) {
    throw new AppError(
      400,
      'ADDRESS_CHOICE_REQUIRED',
      'Address choice is required',
      'addressChoice'
    );
  }
  return choice === 'google'
    ? { address: googleAddress, write: true }
    : { address: comparison.current, write: false };
}

export async function preview(venueId: string, placeId: string) {
  const database = requireDb();
  const venueSnap = await database.collection('venues').doc(venueId).get();
  if (!venueSnap.exists) throw new AppError(404, 'VENUE_NOT_FOUND', 'Venue not found');
  const venue = venueSnap.data()!;

  const info = await fetchPlaceInfo(placeId);
  assertPlaceIdFree((await venuesByPlaceId(placeId).get()).docs, venueId);

  const linkable = collectLinkable((await eventsByPlaceId(placeId).get()).docs);
  assertWithinLimit(linkable.length);

  const comparison = compareAddress(venue.address, info.formattedAddress);
  return {
    placeId,
    unchanged: venue.placeId === placeId,
    google: {
      formattedAddress: info.formattedAddress,
      lat: info.lat,
      lng: info.lng,
      isAddressType: isAddressPlaceId(placeId),
      types: info.types,
    },
    address: {
      current: comparison.current,
      google: info.formattedAddress,
      sameAfterNormalize: comparison.same,
      choiceRequired: comparison.choiceRequired,
    },
    linkableEvents: linkable.slice(0, PREVIEW_LIST_LIMIT).map(({ id, title }) => ({ id, title })),
    linkableEventCount: linkable.length,
  };
}

export async function apply(venueId: string, placeId: string, addressChoice?: AddressChoice) {
  const database = requireDb();
  // Network I/O stays outside the transaction so retries never re-hit Google
  const info = await fetchPlaceInfo(placeId);
  const venueRef = database.collection('venues').doc(venueId);

  const result = await database.runTransaction(async tx => {
    const venueSnap = await tx.get(venueRef);
    if (!venueSnap.exists) throw new AppError(404, 'VENUE_NOT_FOUND', 'Venue not found');
    const venue = venueSnap.data()!;

    assertPlaceIdFree((await tx.get(venuesByPlaceId(placeId))).docs, venueId);
    const linkable = collectLinkable((await tx.get(eventsByPlaceId(placeId))).docs);
    assertWithinLimit(linkable.length);

    const { address, write } = pickAddress(
      compareAddress(venue.address, info.formattedAddress),
      info.formattedAddress,
      addressChoice
    );

    // Same union as syncEventVenue: dedupe by path so re-linking never double counts
    const refs = new Map(
      ((venue.eventRefs ?? []) as DocumentReference[]).map(ref => [ref.path, ref])
    );
    linkable.forEach(event => refs.set(event.ref.path, event.ref));

    tx.update(venueRef, {
      placeId,
      lat: info.lat,
      lng: info.lng,
      ...(write ? { address } : {}),
      eventRefs: [...refs.values()],
      eventCount: refs.size,
      updatedAt: FieldValue.serverTimestamp(),
    });
    linkable.forEach(event => tx.update(event.ref, { 'location.venueId': venueId }));

    return {
      venueId,
      placeId,
      lat: info.lat,
      lng: info.lng,
      address,
      linkedEvents: linkable.map(({ id, title }) => ({ id, title })),
      linkedCount: linkable.length,
    };
  });

  cache.delete('venues:all');
  cache.delete(`venue:detail:${venueId}`);
  cache.delete(`venue:admin:detail:${venueId}`);
  cache.clearPattern('admin:venues:');
  cache.clearPattern('event:');
  cache.clearPattern('events:');

  return result;
}
