import { FieldValue } from 'firebase-admin/firestore';
import { VenueService } from '../../src/services/venueService';

const mockUpdate = jest.fn();

jest.mock('../../src/config/firebase', () => ({
  hasFirebaseConfig: true,
  db: {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({ update: mockUpdate })),
    })),
  },
}));

describe('VenueService.incrementViewCount', () => {
  it('使用 FieldValue.increment(1) 原子累加', async () => {
    const incrementSpy = jest.spyOn(FieldValue, 'increment');
    mockUpdate.mockResolvedValue(undefined);

    await new VenueService().incrementViewCount('venue-1');

    expect(incrementSpy).toHaveBeenCalledWith(1);
    expect(mockUpdate).toHaveBeenCalledWith({ viewCount: expect.anything() });
    incrementSpy.mockRestore();
  });
});
