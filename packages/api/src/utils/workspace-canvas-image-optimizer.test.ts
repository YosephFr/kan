import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import type { dbClient } from "@kan/db/client";
import { MAX_WORKSPACE_CANVAS_OPTIMIZED_IMAGE_BYTES } from "@kan/shared";

import type * as OptimizationSlot from "./workspace-canvas-image-optimization-slot";
import {
  createWorkspaceCanvasImageOptimizationScheduler,
  optimizeWorkspaceCanvasImage,
  WorkspaceCanvasImageOptimizationError,
} from "./workspace-canvas-image-optimizer";

vi.mock(
  "./workspace-canvas-image-optimization-slot",
  async (importOriginal) => {
    const actual = await importOriginal<typeof OptimizationSlot>();
    return {
      ...actual,
      withWorkspaceCanvasImageGlobalOptimizationSlot: vi.fn(
        async (_db: dbClient, operation: () => Promise<unknown>) => operation(),
      ),
    };
  },
);

const db = {} as dbClient;

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
};

describe("workspace canvas image optimizer", () => {
  it("auto-rotates JPEG input and returns a stripped WebP", async () => {
    const source = await sharp({
      create: {
        width: 20,
        height: 40,
        channels: 3,
        background: "#cc5500",
      },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const result = await optimizeWorkspaceCanvasImage(db, source, "image/jpeg");
    const metadata = await sharp(result.bytes).metadata();

    expect(result.contentType).toBe("image/webp");
    expect([result.width, result.height]).toEqual([40, 20]);
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("preserves transparency and never enlarges the source", async () => {
    const source = await sharp({
      create: {
        width: 320,
        height: 180,
        channels: 4,
        background: { r: 10, g: 20, b: 30, alpha: 0.4 },
      },
    })
      .png()
      .toBuffer();

    const result = await optimizeWorkspaceCanvasImage(db, source, "image/png");
    const metadata = await sharp(result.bytes).metadata();

    expect([result.width, result.height]).toEqual([320, 180]);
    expect(metadata.hasAlpha).toBe(true);
  });

  it("reduces noisy input until it fits the output budget", async () => {
    const pixels = randomBytes(1024 * 1024 * 3);
    const source = await sharp(pixels, {
      raw: { width: 1024, height: 1024, channels: 3 },
    })
      .png()
      .toBuffer();

    const result = await optimizeWorkspaceCanvasImage(db, source, "image/png");

    expect(result.size).toBeLessThanOrEqual(
      MAX_WORKSPACE_CANVAS_OPTIMIZED_IMAGE_BYTES,
    );
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(1024);
  });

  it("rejects a MIME mismatch before transformation", async () => {
    const source = await sharp({
      create: {
        width: 10,
        height: 10,
        channels: 3,
        background: "#ffffff",
      },
    })
      .png()
      .toBuffer();

    await expect(
      optimizeWorkspaceCanvasImage(db, source, "image/jpeg"),
    ).rejects.toEqual(
      new WorkspaceCanvasImageOptimizationError("IMAGE_INVALID"),
    );
  });

  it("rejects dimensions over the source limit", async () => {
    const source = await sharp({
      create: {
        width: 8193,
        height: 1,
        channels: 3,
        background: "#ffffff",
      },
    })
      .png()
      .toBuffer();

    await expect(
      optimizeWorkspaceCanvasImage(db, source, "image/png"),
    ).rejects.toEqual(
      new WorkspaceCanvasImageOptimizationError("IMAGE_DIMENSIONS_INVALID"),
    );
  });

  it("rejects malformed input without exposing decoder details", async () => {
    await expect(
      optimizeWorkspaceCanvasImage(db, new Uint8Array([1, 2, 3]), "image/webp"),
    ).rejects.toEqual(
      new WorkspaceCanvasImageOptimizationError("IMAGE_INVALID"),
    );
  });

  it("runs at most two optimizations and starts queued work in order", async () => {
    const schedule = createWorkspaceCanvasImageOptimizationScheduler({
      concurrency: 2,
      queueLimit: 2,
      waitTimeoutMs: 1_000,
    });
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()];
    const started: number[] = [];
    const operations = gates.map((gate, index) =>
      schedule(async () => {
        started.push(index);
        await gate.promise;
        return index;
      }),
    );

    expect(started).toEqual([0, 1]);
    gates[0]?.resolve();
    await expect(operations[0]).resolves.toBe(0);
    expect(started).toEqual([0, 1, 2]);

    gates[1]?.resolve();
    gates[2]?.resolve();
    await expect(Promise.all(operations)).resolves.toEqual([0, 1, 2]);
  });

  it("does not read a queued image body before a slot is available", async () => {
    const schedule = createWorkspaceCanvasImageOptimizationScheduler({
      concurrency: 1,
      queueLimit: 1,
      waitTimeoutMs: 1_000,
    });
    const gate = deferred<void>();
    let queuedBodyReads = 0;
    const active = schedule(async () => {
      await gate.promise;
    });
    const queued = schedule(() => {
      queuedBodyReads += 1;
      return Promise.resolve();
    });

    expect(queuedBodyReads).toBe(0);
    gate.resolve();
    await active;
    await queued;
    expect(queuedBodyReads).toBe(1);
  });

  it("rejects work beyond the bounded queue without starting it", async () => {
    const schedule = createWorkspaceCanvasImageOptimizationScheduler({
      concurrency: 1,
      queueLimit: 1,
      waitTimeoutMs: 1_000,
    });
    const gate = deferred<void>();
    let overflowStarted = false;
    const active = schedule(async () => {
      await gate.promise;
    });
    const queued = schedule(() => Promise.resolve(undefined));

    await expect(
      schedule(() => {
        overflowStarted = true;
        return Promise.resolve();
      }),
    ).rejects.toEqual(
      new WorkspaceCanvasImageOptimizationError("IMAGE_OPTIMIZATION_BUSY"),
    );
    expect(overflowStarted).toBe(false);

    gate.resolve();
    await expect(Promise.all([active, queued])).resolves.toEqual([
      undefined,
      undefined,
    ]);
  });

  it("times out queued work and recovers capacity", async () => {
    vi.useFakeTimers();
    try {
      const schedule = createWorkspaceCanvasImageOptimizationScheduler({
        concurrency: 1,
        queueLimit: 1,
        waitTimeoutMs: 1_000,
      });
      const gate = deferred<void>();
      const active = schedule(async () => {
        await gate.promise;
      });
      const timedOut = schedule(() => Promise.resolve("stale"));
      const timedOutExpectation = expect(timedOut).rejects.toEqual(
        new WorkspaceCanvasImageOptimizationError("IMAGE_OPTIMIZATION_BUSY"),
      );

      await vi.advanceTimersByTimeAsync(1_000);
      await timedOutExpectation;

      gate.resolve();
      await active;
      await expect(schedule(() => Promise.resolve("recovered"))).resolves.toBe(
        "recovered",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
