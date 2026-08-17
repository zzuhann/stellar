import { CoffeeEvent } from '../models/types';

/**
 * Strip submitter PII before an event is serialized into an API response.
 * createdByEmail is only used internally (approval/rejection notification emails)
 * and must never reach a read endpoint — public or authenticated.
 */
export function toPublicEvent<T extends CoffeeEvent>(event: T): T {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { createdByEmail: _createdByEmail, ...publicEvent } = event;
  return publicEvent as T;
}

export function toPublicEvents<T extends CoffeeEvent>(events: T[]): T[] {
  return events.map(toPublicEvent);
}
