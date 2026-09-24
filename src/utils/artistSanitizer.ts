import { Artist } from '../models/types';

/**
 * Strip submitter identity before an artist is serialized into a public API response.
 * createdBy (submitter UID) and createdByEmail are only used internally
 * (ownership checks, approval notification emails) and must never reach
 * a fully public, unauthenticated read endpoint like GET /artists/:id.
 */
export function toPublicArtist<T extends Artist>(
  artist: T
): Omit<T, 'createdBy' | 'createdByEmail'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { createdBy: _createdBy, createdByEmail: _createdByEmail, ...publicArtist } = artist;
  return publicArtist;
}
