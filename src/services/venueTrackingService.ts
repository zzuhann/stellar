import { createHash } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { db, hasFirebaseConfig } from '../config/firebase';
import { withTimeoutAndRetry } from '../utils/firestoreTimeout';

type VenueTrackingEventType = 'venue_list_served' | 'venue_detail_served';

export interface VenueTrackingContext {
  requestId: string;
  sessionId: string;
  userId: string;
}

interface VenueListServedMetadata {
  region: string[];
  capacity: string | null;
  result_count: number;
}

interface VenueDetailServedMetadata {
  venue_id: string;
}

export class VenueTrackingService {
  private collection = hasFirebaseConfig && db ? db.collection('analyticsVenueEventsRaw') : null;

  async trackVenueListServed(
    context: VenueTrackingContext,
    metadata: VenueListServedMetadata
  ): Promise<void> {
    const targetKey = `regions:${metadata.region.join(',')}|capacity:${metadata.capacity ?? ''}|results:${metadata.result_count}`;
    await this.recordEvent('venue_list_served', context, targetKey, metadata);
  }

  async trackVenueDetailServed(
    context: VenueTrackingContext,
    metadata: VenueDetailServedMetadata
  ): Promise<void> {
    await this.recordEvent('venue_detail_served', context, `venue:${metadata.venue_id}`, metadata);
  }

  private async recordEvent(
    eventType: VenueTrackingEventType,
    context: VenueTrackingContext,
    targetKey: string,
    metadata: VenueListServedMetadata | VenueDetailServedMetadata
  ): Promise<void> {
    if (!this.collection) return;

    const dedupeKey = this.buildDedupeKey(eventType, targetKey, context);
    const docId = `${eventType}:${dedupeKey.slice(0, 40)}`;

    try {
      await withTimeoutAndRetry(() =>
        this.collection!.doc(docId).create({
          event_type: eventType,
          request_id: context.requestId,
          session_id: context.sessionId,
          user_id: context.userId,
          dedupe_key: dedupeKey,
          metadata,
          ts: FieldValue.serverTimestamp(),
        })
      );
    } catch (error) {
      if (this.isDuplicateCreateError(error)) {
        return;
      }
      throw error;
    }
  }

  private buildDedupeKey(
    eventType: VenueTrackingEventType,
    targetKey: string,
    context: VenueTrackingContext
  ): string {
    const identityKey = context.requestId
      ? `request:${context.requestId}`
      : `session:${context.sessionId || 'anonymous'}:bucket:${this.get10MinuteBucket()}`;

    return createHash('sha256').update(`${eventType}|${targetKey}|${identityKey}`).digest('hex');
  }

  private get10MinuteBucket(nowMs: number = Date.now()): number {
    return Math.floor(nowMs / (10 * 60 * 1000));
  }

  private isDuplicateCreateError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;

    const code = (error as { code?: unknown }).code;
    const message = error.message.toLowerCase();

    return (
      code === 6 ||
      code === 'already-exists' ||
      code === 'ALREADY_EXISTS' ||
      message.includes('already exists')
    );
  }
}
