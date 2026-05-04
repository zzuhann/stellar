import { Timestamp } from 'firebase-admin/firestore';

export function generateEventSlug(
  artistSlugsOrFallbacks: string[],
  startTimestamp: Timestamp,
  firestoreId: string
): string {
  const date = startTimestamp.toDate();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const idPart = firestoreId.substring(0, 6);

  let artistPart: string;
  if (artistSlugsOrFallbacks.length === 1) {
    artistPart = artistSlugsOrFallbacks[0];
  } else if (artistSlugsOrFallbacks.length === 2) {
    artistPart = artistSlugsOrFallbacks.join('-');
  } else {
    artistPart = `${artistSlugsOrFallbacks[0]}-${artistSlugsOrFallbacks[1]}-collab`;
  }

  return `${artistPart}-${yyyy}-${mm}-${idPart}`;
}
