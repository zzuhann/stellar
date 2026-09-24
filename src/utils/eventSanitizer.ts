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

/**
 * Check whether an event's datetime is usable (not corrupted).
 * Corrupted data only reaches Firestore via manual/external writes — the normal
 * submit path validates datetime with Zod before writing — but when it happens,
 * callers must drop the event rather than crash the whole list (see eventService's
 * getApprovedActiveEventsBase, which reads Timestamp.toMillis() right after this).
 *
 * Returns a human-readable reason string if invalid, or null if the datetime is usable.
 */
export function getInvalidEventDatetimeReason(event: {
  datetime?: { start?: unknown; end?: unknown };
}): string | null {
  const { start, end } = event.datetime ?? {};

  for (const [field, value] of [
    ['datetime.start', start],
    ['datetime.end', end],
  ] as const) {
    if (!value || typeof (value as Timestamp).toDate !== 'function') {
      return `${field} is missing or not a Firestore Timestamp`;
    }
    if (isNaN((value as Timestamp).toDate().getTime())) {
      return `${field} produced an Invalid Date`;
    }
  }

  return null;
}
