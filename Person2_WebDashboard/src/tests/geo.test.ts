/**
 * COORDINATE-FLIP REGRESSION SUITE
 *
 * The [lng, lat] vs [lat, lng] mismatch is the single most dangerous bug in this
 * project: it never throws, and its only symptom is that every check-in fails
 * geofence validation for reasons that look like a backend fault. These tests
 * are the tripwire — if someone "simplifies" the conversion helpers, this fails.
 */
import { describe, expect, it } from 'vitest';
import {
  formatLatLng,
  geoJSONPointSchema,
  haversineMeters,
  isWithinBangladesh,
  looksFlippedForBangladesh,
  pointToLatLng,
  pointToLatLngTuple,
  toGeoJSONPoint,
  toGeoJSONTuple,
  toLatLngTuple,
} from '@/lib/geo';

// Gulshan-2, Dhaka.
const GULSHAN = { lat: 23.7925, lng: 90.4152 };

describe('coordinate order', () => {
  it('converts GeoJSON [lng, lat] to a latitude-first tuple', () => {
    expect(toLatLngTuple([GULSHAN.lng, GULSHAN.lat])).toEqual([GULSHAN.lat, GULSHAN.lng]);
  });

  it('converts named lat/lng values to GeoJSON order', () => {
    expect(toGeoJSONTuple(GULSHAN.lat, GULSHAN.lng)).toEqual([GULSHAN.lng, GULSHAN.lat]);
  });

  it('builds a GeoJSON Point with longitude first', () => {
    const point = toGeoJSONPoint(GULSHAN.lat, GULSHAN.lng);
    expect(point.type).toBe('Point');
    expect(point.coordinates[0]).toBe(GULSHAN.lng);
    expect(point.coordinates[1]).toBe(GULSHAN.lat);
  });

  it('round-trips without drift', () => {
    const point = toGeoJSONPoint(GULSHAN.lat, GULSHAN.lng);
    expect(pointToLatLngTuple(point)).toEqual([GULSHAN.lat, GULSHAN.lng]);
    expect(pointToLatLng(point)).toEqual(GULSHAN);
  });
});

describe('flip detection', () => {
  it('accepts a correctly ordered Dhaka point', () => {
    const result = geoJSONPointSchema.safeParse({
      type: 'Point',
      coordinates: [GULSHAN.lng, GULSHAN.lat],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a reversed Dhaka point before it reaches the database', () => {
    const result = geoJSONPointSchema.safeParse({
      type: 'Point',
      coordinates: [GULSHAN.lat, GULSHAN.lng],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/reversed/i);
    }
  });

  it('identifies the reversed pattern directly', () => {
    expect(looksFlippedForBangladesh([GULSHAN.lat, GULSHAN.lng])).toBe(true);
    expect(looksFlippedForBangladesh([GULSHAN.lng, GULSHAN.lat])).toBe(false);
  });

  it('rejects out-of-range values outright', () => {
    expect(
      geoJSONPointSchema.safeParse({ type: 'Point', coordinates: [90.4, 91.2] }).success,
    ).toBe(false);
  });
});

describe('bounds and distance', () => {
  it('recognises Dhaka as inside Bangladesh', () => {
    expect(isWithinBangladesh(GULSHAN.lat, GULSHAN.lng)).toBe(true);
  });

  it('flags a flipped pin as outside Bangladesh', () => {
    // This is the ocean case: the reversed pin lands far from any office.
    expect(isWithinBangladesh(GULSHAN.lng, GULSHAN.lat)).toBe(false);
  });

  it('measures a short distance the way the backend does', () => {
    const banani = { lat: 23.7937, lng: 90.4003 };
    const metres = haversineMeters(GULSHAN, banani);
    expect(metres).toBeGreaterThan(1_000);
    expect(metres).toBeLessThan(2_500);
  });

  it('labels hemispheres unambiguously', () => {
    expect(formatLatLng(GULSHAN.lat, GULSHAN.lng)).toBe('23.792500 N, 90.415200 E');
  });
});
