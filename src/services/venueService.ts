import { db, hasFirebaseConfig, withTimeoutAndRetry } from '../config/firebase';
import { Venue, VenueFilterParams } from '../models/types';
import { cache } from '../utils/cache';
import { DocumentData, QueryDocumentSnapshot } from 'firebase-admin/firestore';

export class VenueService {
  private collection = hasFirebaseConfig && db ? db.collection('venues') : null;

  private checkFirebaseConfig() {
    if (!hasFirebaseConfig || !this.collection) {
      throw new Error('Firebase 問題，請檢查環境變數');
    }
  }

  private mapDocToVenue(doc: QueryDocumentSnapshot<DocumentData>): Venue {
    const d = doc.data();
    return {
      id: doc.id,
      name: d.name ?? '',
      address: d.address ?? '',
      region: d.region ?? '',
      lat: d.lat ?? 0,
      lng: d.lng ?? 0,
      nearest_mrt: d.nearest_mrt ?? '',
      mrt_walk_minutes: d.mrt_walk_minutes ?? null,
      capacity_max: d.capacity_max ?? null,
      eventCount: d.eventCount ?? 0,
      coverPhoto: d.coverPhoto ?? '',
    };
  }

  private async fetchAll(): Promise<Venue[]> {
    this.checkFirebaseConfig();
    return cache.getWithLock(
      'venues:all',
      async () => {
        const snapshot = await withTimeoutAndRetry(() =>
          this.collection!.orderBy('eventCount', 'desc').get()
        );
        return snapshot.docs.map(doc => this.mapDocToVenue(doc));
      },
      1440
    );
  }

  async getVenues(params: VenueFilterParams): Promise<Venue[]> {
    const { region, capacity_min, capacity_max, sort } = params;

    let venues = await this.fetchAll();

    if (region) {
      venues = venues.filter(v => v.region === region);
    }

    if (capacity_min !== undefined) {
      venues = venues.filter(v => v.capacity_max !== null && v.capacity_max >= capacity_min);
    }

    if (capacity_max !== undefined) {
      venues = venues.filter(v => v.capacity_max !== null && v.capacity_max <= capacity_max);
    }

    if (sort === 'name') {
      venues = [...venues].sort((a, b) => a.name.localeCompare(b.name, 'zh-TW'));
    }

    return venues;
  }
}
