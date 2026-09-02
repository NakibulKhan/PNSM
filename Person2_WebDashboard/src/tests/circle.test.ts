/**
 * GEOFENCE GEOMETRY SUITE
 *
 * The circle an administrator drags on screen must be the same boundary
 * MongoDB enforces. Person 3 validates with `$centerSphere`, whose radius is
 * expressed in RADIANS — metres divided by the Earth's equatorial radius. If
 * that conversion drifts, the visual and the enforced boundary disagree and
 * legitimate check-ins get rejected with no visible cause.
 */
import { describe, expect, it } from 'vitest';
import {
  EARTH_RADIUS_METERS,
  circlePolygon,
  metersToRadians,
  radiansToMeters,
  zoomForRadius,
} from '@/lib/circle';
import { haversineMeters } from '@/lib/geo';

const GULSHAN: [number, number] = [90.4152, 23.7925]; // GeoJSON [lng, lat]

describe('radian conversion mirrors $centerSphere', () => {
  it('uses the WGS-84 equatorial radius MongoDB assumes', () => {
    expect(EARTH_RADIUS_METERS).toBe(6_378_137);
  });

  it('converts a 50 m indoor perimeter the way the backend does', () => {
    // The exact expression in Person 3's query builder.
    expect(metersToRadians(50)).toBeCloseTo(50 / 6378137.0, 15);
  });

  it('round-trips metres through radians without drift', () => {
    [10, 50, 150, 500, 1000].forEach((meters) => {
      expect(radiansToMeters(metersToRadians(meters))).toBeCloseTo(meters, 9);
    });
  });
});

describe('circle polygon', () => {
  it('produces a closed GeoJSON ring', () => {
    const feature = circlePolygon(GULSHAN, 100);
    const ring = feature.geometry.coordinates[0];
    expect(feature.geometry.type).toBe('Polygon');
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('emits coordinates in GeoJSON [lng, lat] order', () => {
    const ring = circlePolygon(GULSHAN, 100).geometry.coordinates[0];
    ring.forEach(([lng, lat]) => {
      // Dhaka: longitude ~90, latitude ~23. A flip would fail both assertions.
      expect(lng).toBeGreaterThan(88);
      expect(lng).toBeLessThan(93);
      expect(lat).toBeGreaterThan(20);
      expect(lat).toBeLessThan(27);
    });
  });

  it('places every vertex at the requested ground distance', () => {
    const radius = 250;
    const ring = circlePolygon(GULSHAN, radius, 32).geometry.coordinates[0];
    const center = { lat: GULSHAN[1], lng: GULSHAN[0] };

    ring.slice(0, -1).forEach(([lng, lat]) => {
      const distance = haversineMeters(center, { lat, lng });
      // Within 1% — the local flat-earth approximation is well inside tolerance
      // at geofence scale, and far tighter than GPS accuracy on a phone.
      expect(Math.abs(distance - radius) / radius).toBeLessThan(0.01);
    });
  });

  it('scales correctly across the full radius range', () => {
    const center = { lat: GULSHAN[1], lng: GULSHAN[0] };
    [10, 50, 500, 1000].forEach((radius) => {
      const first = circlePolygon(GULSHAN, radius).geometry.coordinates[0][0];
      const distance = haversineMeters(center, { lat: first[1], lng: first[0] });
      expect(Math.abs(distance - radius) / radius).toBeLessThan(0.01);
    });
  });

  it('honours the requested vertex count', () => {
    expect(circlePolygon(GULSHAN, 100, 16).geometry.coordinates[0]).toHaveLength(17);
  });
});

describe('framing', () => {
  it('zooms further out for a larger radius', () => {
    const tight = zoomForRadius(23.79, 50);
    const wide = zoomForRadius(23.79, 500);
    expect(wide).toBeLessThan(tight);
  });

  it('stays within MapLibre zoom bounds', () => {
    [10, 1000, 100_000].forEach((radius) => {
      const zoom = zoomForRadius(23.79, radius);
      expect(zoom).toBeGreaterThanOrEqual(3);
      expect(zoom).toBeLessThanOrEqual(19);
    });
  });
});
