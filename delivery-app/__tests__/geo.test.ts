// Unit tests for the app's local route logic (src/geo.ts). Run: npm test
import { decodePolyline, fmtKm, meters, suggestStops } from '../src/geo';

const R = { latitude: 22.55, longitude: 88.35 };
const job = (jobId: string, status: string, lat: number, assignedAgoMin = 1) => ({
  jobId, orderNo: jobId, status, pickup: { ...R, name: 'Zen Cafe' }, drop: { latitude: lat, longitude: 88.36 },
  assignedAt: new Date(Date.now() - assignedAgoMin * 60000).toISOString(),
});

describe('suggestStops', () => {
  it('puts ONE restaurant stop first for every order not yet picked up', () => {
    const s = suggestStops([job('a', 'ASSIGNED', 22.54), job('b', 'AT_RESTAURANT', 22.53), job('c', 'PICKED_UP', 22.56)], null, R);
    expect(s[0].kind).toBe('PICKUP');
    expect(s[0].jobIds.sort()).toEqual(['a', 'b']);
    expect(s.filter((x) => x.kind === 'DROP')).toHaveLength(3);
  });
  it('orders drops nearest-next from the restaurant', () => {
    const s = suggestStops([job('far', 'PICKED_UP', 22.60), job('near', 'PICKED_UP', 22.551)], R, R);
    expect(s.map((x) => x.jobIds[0])).toEqual(['near', 'far']);
  });
  it('an order waiting >25 min jumps ahead (food freshness)', () => {
    const s = suggestStops([job('near', 'PICKED_UP', 22.551), job('old', 'PICKED_UP', 22.60, 30)], R, R);
    expect(s[0].jobIds[0]).toBe('old');
  });
  it('never invents an ETA', () => {
    const s = suggestStops([job('a', 'PICKED_UP', 22.54)], R, R);
    expect(s[0].legDurationSec).toBeUndefined();
  });
});

describe('geo helpers', () => {
  it('decodes a Google polyline', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      { latitude: 38.5, longitude: -120.2 }, { latitude: 40.7, longitude: -120.95 }, { latitude: 43.252, longitude: -126.453 },
    ]);
  });
  it('measures and formats distance', () => {
    const m = meters({ latitude: 22.55, longitude: 88.35 }, { latitude: 22.56, longitude: 88.35 });
    expect(Math.round(m)).toBe(1112);
    expect(fmtKm(m)).toBe('1.1 km');
    expect(fmtKm(420)).toBe('420 m');
  });
});
