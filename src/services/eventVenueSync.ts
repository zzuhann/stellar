import { DocumentReference, FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase';
import { cache } from '../utils/cache';
import { AppError } from '../utils/AppError';

// Keep the event and both sides of a venue move in one transaction.
export async function syncEventVenue(eventId: string, updates: Record<string, unknown> = {}) {
  if (!db) throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Firebase unavailable');
  const eventRef = db.collection('coffeeEvents').doc(eventId);
  await db.runTransaction(async tx => {
    const eventDoc = await tx.get(eventRef);
    if (!eventDoc.exists) throw new AppError(404, 'EVENT_NOT_FOUND', '活動不存在');
    const event = eventDoc.data()!;
    const location = { ...(updates.location ?? event.location) };
    const changed =
      location.placeId !== event.location?.placeId ||
      (!location.placeId &&
        (location.address !== event.location?.address ||
          location.coordinates?.lat !== event.location?.coordinates?.lat ||
          location.coordinates?.lng !== event.location?.coordinates?.lng));
    delete location.venueId;
    delete location.venueActive;

    let venueId = !changed ? event.location?.venueId : undefined;
    if (!venueId && event.status === 'approved' && location.placeId) {
      const matches = await tx.get(
        db!.collection('venues').where('placeId', '==', location.placeId).limit(2)
      );
      // Ambiguous matches require review instead of choosing an arbitrary venue.
      if (matches.size === 1) venueId = matches.docs[0].id;
    }
    const target = venueId ? await tx.get(db!.collection('venues').doc(venueId)) : undefined;
    if (!target?.exists) venueId = undefined;
    const previous = await tx.get(
      db!.collection('venues').where('eventRefs', 'array-contains', eventRef)
    );

    for (const venue of previous.docs) {
      if (venue.id === venueId) continue;
      const refs = (venue.data().eventRefs ?? []) as DocumentReference[];
      const remaining = refs.filter(ref => ref.path !== eventRef.path);
      tx.update(venue.ref, { eventRefs: remaining, eventCount: remaining.length });
    }
    if (venueId && target) {
      const refs = (target.data()!.eventRefs ?? []) as DocumentReference[];
      const unique = new Map(refs.map(ref => [ref.path, ref]));
      unique.set(eventRef.path, eventRef);
      tx.update(target.ref, { eventRefs: [...unique.values()], eventCount: unique.size });
      location.venueId = venueId;
    }
    if (updates.location) {
      tx.update(eventRef, { ...updates, location });
    } else {
      tx.update(eventRef, { ...updates, 'location.venueId': venueId ?? FieldValue.delete() });
    }
  });
  cache.clearPattern('venue:');
  cache.delete('venues:all');
  cache.clearPattern('admin:venues:');
  cache.clearPattern('event:');
  cache.clearPattern('events:');
}
