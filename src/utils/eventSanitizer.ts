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
 * Best-effort conversion of a single datetime field to an ISO 8601 string.
 * Historical Firestore docs can have a missing/non-Timestamp/invalid value in
 * datetime.start|end. Rather than throwing (which would fail the whole list
 * response for every event in the batch), log a warning and fall back to ''
 * so the caller still gets a string-typed field and the rest of the response
 * is unaffected.
 */
function toIsoStringOrFallback(
  value: unknown,
  eventId: string | undefined,
  field: 'start' | 'end'
): string {
  const isTimestampLike = !!value && typeof (value as Partial<Timestamp>).toDate === 'function';
  if (!isTimestampLike) {
    console.warn(
      `serializeEventDatetime: datetime.${field} is missing or not a Firestore Timestamp (eventId: ${eventId ?? 'unknown'}), falling back to ''`
    );
    return '';
  }

  const date = (value as Timestamp).toDate();
  if (Number.isNaN(date.getTime())) {
    console.warn(
      `serializeEventDatetime: datetime.${field} converted to an invalid date (eventId: ${eventId ?? 'unknown'}), falling back to ''`
    );
    return '';
  }

  return date.toISOString();
}

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
  const eventId = (event as unknown as { id?: string }).id;
  return {
    ...event,
    datetime: {
      start: toIsoStringOrFallback(event?.datetime?.start, eventId, 'start'),
      end: toIsoStringOrFallback(event?.datetime?.end, eventId, 'end'),
    },
  };
}

export function serializeEventsDatetime<
  T extends { datetime: { start: Timestamp; end: Timestamp } },
>(events: T[]): WithIsoDatetime<T>[] {
  return events.map(serializeEventDatetime);
}
