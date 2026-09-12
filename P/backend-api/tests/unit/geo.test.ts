import {
  toGeoJSONPoint,
  pointToLatLng,
  looksFlippedForBangladesh,
  isWithinBangladesh,
  haversineMeters,
  isValidLatitude,
  isValidLongitude,
  isValidLatLng,
  metersToRadians,
  EARTH_EQUATORIAL_RADIUS_METERS,
  EARTH_MEAN_RADIUS_METERS,
} from '@/utils/geo';

describe('geo utils', () => {
  it('accepts valid latitudes at and within range', () => {
    expect(isValidLatitude(0)).toBe(true);
    expect(isValidLatitude(23.81)).toBe(true);
    expect(isValidLatitude(90)).toBe(true);
    expect(isValidLatitude(-90)).toBe(true);
  });

  it('rejects invalid latitudes outside range or non-finite', () => {
    expect(isValidLatitude(90.0001)).toBe(false);
    expect(isValidLatitude(-90.0001)).toBe(false);
    expect(isValidLatitude(200)).toBe(false);
    expect(isValidLatitude(NaN)).toBe(false);
    expect(isValidLatitude(Infinity)).toBe(false);
  });

  it('accepts valid longitudes at and within range', () => {
    expect(isValidLongitude(0)).toBe(true);
    expect(isValidLongitude(90.41)).toBe(true);
    expect(isValidLongitude(180)).toBe(true);
    expect(isValidLongitude(-180)).toBe(true);
  });

  it('rejects invalid longitudes outside range or non-finite', () => {
    expect(isValidLongitude(180.0001)).toBe(false);
    expect(isValidLongitude(-180.0001)).toBe(false);
    expect(isValidLongitude(NaN)).toBe(false);
    expect(isValidLongitude(-Infinity)).toBe(false);
  });

  it('isValidLatLng requires both components valid', () => {
    expect(isValidLatLng({ lat: 23.81, lng: 90.41 })).toBe(true);
    expect(isValidLatLng({ lat: 200, lng: 90.41 })).toBe(false);
    expect(isValidLatLng({ lat: 23.81, lng: 999 })).toBe(false);
  });

  it('round-trips lat/lng through GeoJSON as [lng, lat]', () => {
    const point = toGeoJSONPoint({ lat: 23.7925, lng: 90.4152 });
    expect(point).toEqual({ type: 'Point', coordinates: [90.4152, 23.7925] });
    expect(pointToLatLng(point)).toEqual({ lat: 23.7925, lng: 90.4152 });
  });

  it('does not flag correctly-ordered Dhaka coordinates as flipped', () => {
    // Correct: [lng, lat] = [90.41, 23.79]
    expect(looksFlippedForBangladesh([90.41, 23.79])).toBe(false);
  });

  it('flags a reversed Dhaka coordinate pair', () => {
    // Reversed: written as [lat, lng] = [23.79, 90.41]
    expect(looksFlippedForBangladesh([23.79, 90.41])).toBe(true);
  });

  it('confirms a known Dhaka point is within Bangladesh bounds', () => {
    expect(isWithinBangladesh({ lat: 23.8103, lng: 90.4125 })).toBe(true);
  });

  it('rejects a point far outside Bangladesh bounds', () => {
    expect(isWithinBangladesh({ lat: 40.7128, lng: -74.006 })).toBe(false);
  });

  it('computes a plausible distance between two nearby points', () => {
    // Two points ~150m apart in Dhaka (rough hand-checked estimate).
    const a = { lat: 23.8103, lng: 90.4125 };
    const b = { lat: 23.8117, lng: 90.4125 };
    const distance = haversineMeters(a, b);
    expect(distance).toBeGreaterThan(100);
    expect(distance).toBeLessThan(200);
  });

  it('returns ~0 for identical points', () => {
    const p = { lat: 23.81, lng: 90.41 };
    expect(haversineMeters(p, p)).toBeCloseTo(0, 5);
  });

  it('converts metres to radians using the EQUATORIAL radius, as $centerSphere requires', () => {
    expect(metersToRadians(EARTH_EQUATORIAL_RADIUS_METERS)).toBeCloseTo(1, 10);
    expect(metersToRadians(100)).toBeCloseTo(100 / 6378137, 12);
  });

  it('keeps the equatorial and mean radii as distinct constants', () => {
    // These are different numbers for different reasons: equatorial for
    // $centerSphere, mean for Haversine. Collapsing them into one constant
    // is a real (if small) correctness bug on geofence boundaries.
    expect(EARTH_EQUATORIAL_RADIUS_METERS).toBe(6378137);
    expect(EARTH_MEAN_RADIUS_METERS).toBe(6371000);
    expect(EARTH_EQUATORIAL_RADIUS_METERS).not.toBe(EARTH_MEAN_RADIUS_METERS);
  });

  it('produces a radian value small enough to be a real geofence, not the whole planet', () => {
    // The classic $centerSphere bug is passing metres straight through: a
    // 100 m radius would become 100 radians and match everything on Earth.
    expect(metersToRadians(100)).toBeLessThan(0.001);
  });
});
