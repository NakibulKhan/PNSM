import { describe, it, expect } from "vitest";
import { distanceMeters, isInsideGeofence, metersToRadians, toGeoJsonPoint } from "../src/lib/geofence";

// Known Dhaka coordinates, used only as test fixtures — production code gets
// these from GET /api/mobile/me now (DECISIONS.md N4), not a client constant.
const HQ = { lat: 23.8151, lng: 90.4257 };
const NORTH = { lat: 23.8759, lng: 90.3795 };
const SOUTH = { lat: 23.7461, lng: 90.3742 };

describe("distanceMeters", () => {
  it("is ~0 for identical points", () => {
    expect(distanceMeters(HQ.lat, HQ.lng, HQ.lat, HQ.lng)).toBeCloseTo(0, 3);
  });
  it("is symmetric", () => {
    const a = distanceMeters(HQ.lat, HQ.lng, SOUTH.lat, SOUTH.lng);
    const b = distanceMeters(SOUTH.lat, SOUTH.lng, HQ.lat, HQ.lng);
    expect(a).toBeCloseTo(b, 6);
  });
  it("matches a known Dhaka reference distance (Bashundhara -> Uttara)", () => {
    const d = distanceMeters(HQ.lat, HQ.lng, NORTH.lat, NORTH.lng);
    expect(d).toBeGreaterThan(5000);
    expect(d).toBeLessThan(10000);
  });
});

describe("isInsideGeofence", () => {
  const office = { lat: 23.8151, lng: 90.4257, radiusMeters: 150 };
  it("accepts the exact centre", () => {
    expect(isInsideGeofence(office.lat, office.lng, office)).toBe(true);
  });
  it("accepts a point ~100m away inside a 150m radius", () => {
    expect(isInsideGeofence(office.lat + 0.0009, office.lng, office)).toBe(true);
  });
  it("rejects a point ~550m away", () => {
    expect(isInsideGeofence(office.lat + 0.005, office.lng, office)).toBe(false);
  });
  it("rejects another branch entirely", () => {
    expect(isInsideGeofence(SOUTH.lat, SOUTH.lng, office)).toBe(false);
  });
});

describe("backend interop", () => {
  it("metersToRadians uses the same earth radius as Person 3's documented formula", () => {
    // Blueprint Quadrant III: radius / 6378137.0
    expect(metersToRadians(150)).toBeCloseTo(150 / 6378137.0, 12);
  });
  it("toGeoJsonPoint emits [longitude, latitude], not [lat, lng]", () => {
    const p = toGeoJsonPoint(23.8151, 90.4257);
    expect(p.type).toBe("Point");
    expect(p.coordinates[0]).toBe(90.4257); // lng first
    expect(p.coordinates[1]).toBe(23.8151);
  });
});
