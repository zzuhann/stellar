import { Artist } from '../models/types';

/**
 * Strip internal-only fields before an artist is serialized into a public API response.
 * - createdBy (submitter UID) and createdByEmail (submitter email) are only used
 *   internally (ownership checks, approval notification emails).
 * - rejectedReason is an admin-only note explaining why a submission was rejected;
 *   getArtistById does not filter by status, so a rejected artist's ID/slug would
 *   otherwise leak this note to anyone.
 * None of these must reach a fully public, unauthenticated read endpoint like
 * GET /artists/:id.
 */
export function toPublicArtist<T extends Artist>(
  artist: T
): Omit<T, 'createdBy' | 'createdByEmail' | 'rejectedReason'> {
  const {
    createdBy: _createdBy, // eslint-disable-line @typescript-eslint/no-unused-vars
    createdByEmail: _createdByEmail, // eslint-disable-line @typescript-eslint/no-unused-vars
    rejectedReason: _rejectedReason, // eslint-disable-line @typescript-eslint/no-unused-vars
    ...publicArtist
  } = artist;
  return publicArtist;
}
