import { Timestamp } from 'firebase-admin/firestore';
import { CoffeeEvent } from '../models/types';

/**
 * Strip submitter PII before an event is serialized into an API response.
 * createdByEmail is only used internally (approval/rejection notification emails)
 * and must never reach a read endpoint — public or authenticated.
 */
export function toPublicEvent<T extends CoffeeEvent>(event: T): Omit<T, 'createdByEmail'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { createdByEmail: _createdByEmail, ...publicEvent } = event;
  return publicEvent;
}

export function toPublicEvents<T extends CoffeeEvent>(events: T[]): Omit<T, 'createdByEmail'>[] {
  return events.map(toPublicEvent);
}

type WithIsoDatetime<T extends { datetime: { start: Timestamp; end: Timestamp } }> = Omit<
  T,
  'datetime'
> & { datetime: { start: string; end: string } };

/**
 * Convert datetime.start/end from Firestore Timestamp to ISO 8601 strings for API responses.
 * Only applied to the GET /events list response, to match /events/map-data's existing format
 * (see eventService.getMapData). Does not touch Firestore-stored data, and is not wired into
 * toPublicEvent(s) so it doesn't change the response shape of other endpoints (detail, search,
 * trending, favorites) that still return raw Timestamp objects.
 */
export function serializeEventDatetime<
  T extends { datetime: { start: Timestamp; end: Timestamp } },
>(event: T): WithIsoDatetime<T> {
  return {
    ...event,
    datetime: {
      start: event.datetime.start.toDate().toISOString(),
      end: event.datetime.end.toDate().toISOString(),
    },
  };
}

export function serializeEventsDatetime<
  T extends { datetime: { start: Timestamp; end: Timestamp } },
>(events: T[]): WithIsoDatetime<T>[] {
  return events.map(serializeEventDatetime);
}
