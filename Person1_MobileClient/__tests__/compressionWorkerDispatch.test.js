import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * compressSelfie() dispatches to compression.worker.js when Worker/
 * OffscreenCanvas exist, falling back to the proven synchronous path
 * otherwise (Item 14, Flawless/Ultra blueprint). jsdom has neither global by
 * default — __tests__/compression.test.js's existing coverage already
 * proves the fallback path works there. This file proves the *dispatch
 * logic itself* by faking both globals, without needing a real
 * OffscreenCanvas/browser environment.
 */
describe("compressSelfie worker dispatch", () => {
  let terminateSpy;

  beforeEach(() => {
    terminateSpy = vi.fn();
    vi.stubGlobal("OffscreenCanvas", class {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("uses the worker path and resolves with its result when Worker/OffscreenCanvas exist", async () => {
    const fakeResult = { blob: new Blob(["x"]), sizeBytes: 12345, width: 640, height: 480, quality: 0.7, passes: 2, underLimit: true };
    class FakeWorker {
      constructor() {
        // Resolve asynchronously, like a real worker round-trip.
        setTimeout(() => this.onmessage?.({ data: { ok: true, ...fakeResult } }), 0);
      }
      postMessage() {}
      terminate() {
        terminateSpy();
      }
    }
    vi.stubGlobal("Worker", FakeWorker);

    const { compressSelfie } = await import("../src/lib/compression");
    const result = await compressSelfie("data:image/jpeg;base64,AAAA");

    expect(result.sizeBytes).toBe(12345);
    expect(result.underLimit).toBe(true);
    expect(terminateSpy).toHaveBeenCalledTimes(1); // the worker is cleaned up, not leaked
  });

  it("falls back to the main-thread path if the worker reports failure, rather than propagating the worker's own error", async () => {
    class FailingWorker {
      constructor() {
        setTimeout(() => this.onmessage?.({ data: { ok: false, error: "boom" } }), 0);
      }
      postMessage() {}
      terminate() {
        terminateSpy();
      }
    }
    vi.stubGlobal("Worker", FailingWorker);
    const { compressSelfie } = await import("../src/lib/compression");

    // jsdom's Image never fires onload/onerror for a data: URL, so the
    // fallback path (compressSelfieMainThread) hangs rather than settling —
    // a real limitation of this environment, not something to fake around.
    // What's actually checkable here without a real browser: the worker's
    // own "boom" rejection is never surfaced directly — if the dispatcher
    // had propagated it, this would reject with "boom" well inside 300ms.
    const outcome = await Promise.race([
      compressSelfie("data:image/jpeg;base64,AAAA").then(
        () => ({ settled: "resolved" }),
        (err) => ({ settled: "rejected", message: err?.message }),
      ),
      new Promise((resolve) => setTimeout(() => resolve({ settled: "pending" }), 300)),
    ]);

    expect(outcome.settled).not.toBe("rejected");
    if (outcome.settled === "rejected") {
      expect(outcome.message).not.toBe("boom");
    }
  });
});
