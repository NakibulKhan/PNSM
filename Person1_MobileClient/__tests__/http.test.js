import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression test for a real bug a live end-to-end run (ROADMAP.md Phase 5)
 * caught: the response interceptor treated EVERY 401 from the mobile API as
 * "your session expired", including a wrong-PIN check-in rejection, which
 * also legitimately returns 401 per the shared mobile response convention
 * (ADR-1's mobileError — see Person3_BackendAPI/src/responses/mobileResponse.ts).
 * That meant entering one incorrect PIN: (1) silently triggered a token
 * refresh + retry of the SAME check-in request, burning a second PIN
 * attempt server-side for what the employee experienced as one mistake, and
 * (2) when that retry also 401'd (correctly — the PIN really was wrong),
 * fell into the "refresh failed" branch and logged the employee out
 * entirely, discarding a perfectly valid session.
 *
 * axios.create is mocked so the interceptor functions registered by
 * http.js can be captured and invoked directly, without a real network
 * call — this only needs to prove which branch runs for which `reason`.
 */

const mockPost = vi.fn();
let capturedResponseErrorHandler;

vi.mock("axios", () => {
  const create = vi.fn(() => ({
    interceptors: {
      request: { use: vi.fn() },
      response: {
        use: vi.fn((_onSuccess, onError) => {
          capturedResponseErrorHandler = onError;
        }),
      },
    },
  }));
  return {
    default: { create, post: mockPost },
    create,
    post: mockPost,
  };
});

describe("http.js response interceptor", () => {
  let http;

  beforeEach(async () => {
    vi.resetModules();
    mockPost.mockReset();
    capturedResponseErrorHandler = undefined;
    http = await import("../src/lib/http.js");
  });

  function makeError({ status, reason }) {
    return {
      config: { url: "/api/mobile/attendance/checkin", headers: {} },
      response: { status, data: { status: "rejected", reason, face_match_score: null } },
    };
  }

  it("does NOT attempt a refresh for a pin_mismatch 401 (a business rejection, not an expired session)", async () => {
    const onSessionExpired = vi.fn();
    http.setSessionExpiredHandler(onSessionExpired);
    http.setAccessToken("still-valid-token");

    const error = makeError({ status: 401, reason: "pin_mismatch" });
    await expect(capturedResponseErrorHandler(error)).rejects.toBe(error);

    expect(mockPost).not.toHaveBeenCalled();
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(http.getAccessToken()).toBe("still-valid-token"); // session survives a wrong PIN
  });

  it("does NOT attempt a refresh for any other mobile business-rule 401 (outside_geofence, low_face_match, ...)", async () => {
    const onSessionExpired = vi.fn();
    http.setSessionExpiredHandler(onSessionExpired);

    for (const reason of ["outside_geofence", "mock_location_detected", "liveness_failed", "low_face_match"]) {
      const error = makeError({ status: 401, reason });
      await expect(capturedResponseErrorHandler(error)).rejects.toBe(error);
    }

    expect(mockPost).not.toHaveBeenCalled();
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it("still refreshes and retries for a genuine unauthenticated 401 (session actually expired)", async () => {
    mockPost.mockResolvedValue({ data: { access_token: "fresh-token" } });
    const onSessionExpired = vi.fn();
    http.setSessionExpiredHandler(onSessionExpired);

    const error = makeError({ status: 401, reason: "unauthenticated" });
    // The retried call goes through the real (mocked-away) axios instance;
    // asserting on mockPost alone is enough to prove refresh was attempted.
    capturedResponseErrorHandler(error).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockPost).toHaveBeenCalledWith(
      expect.stringContaining("/api/mobile/auth/refresh"),
      expect.any(Object),
      expect.objectContaining({ withCredentials: true }),
    );
  });

  /**
   * Regression tests for a second real bug, found by the final master audit.
   *
   * The server pins the refresh cookie to `path=/api/auth`
   * (Person3_BackendAPI/src/utils/jwt.ts). Cookie path matching is a prefix
   * test, so that cookie is NEVER sent to /api/mobile/auth/refresh. The server
   * anticipates this and accepts `refresh_token` in the body instead
   * (mobile/auth.routes.ts — its documented "issue both" design for Capacitor
   * WebViews, DECISIONS.md B1/N3).
   *
   * This client previously satisfied NEITHER branch: it dropped the login
   * response's refresh_token and posted an empty body. Result: every mobile
   * session died at the 15-minute access-token boundary, force-logging out a
   * field employee mid-shift. Invisible under VITE_MOCK_BACKEND=true.
   */
  it("sends the held refresh_token in the body — the cookie can never reach the mobile refresh route", async () => {
    mockPost.mockResolvedValue({ data: { access_token: "fresh-token" } });
    http.setRefreshToken("stored-refresh-token");
    http.setSessionExpiredHandler(vi.fn());

    capturedResponseErrorHandler(makeError({ status: 401, reason: "unauthenticated" })).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockPost).toHaveBeenCalledWith(
      expect.stringContaining("/api/mobile/auth/refresh"),
      { refresh_token: "stored-refresh-token" },
      expect.objectContaining({ withCredentials: true }),
    );
  });

  it("stores the ROTATED refresh_token from the response — the server invalidates the previous one", async () => {
    mockPost.mockResolvedValue({
      data: { access_token: "fresh-token", refresh_token: "rotated-refresh-token" },
    });
    http.setRefreshToken("original-refresh-token");
    http.setSessionExpiredHandler(vi.fn());

    capturedResponseErrorHandler(makeError({ status: 401, reason: "unauthenticated" })).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Miss this and the NEXT refresh presents an already-dead token.
    expect(http.getRefreshToken()).toBe("rotated-refresh-token");
  });

  it("clears the refresh token on sign-out, and never persists it anywhere", async () => {
    http.setAccessToken("a");
    http.setRefreshToken("r");

    http.clearAccessToken();

    expect(http.getAccessToken()).toBeNull();
    expect(http.getRefreshToken()).toBeNull();
  });
});
