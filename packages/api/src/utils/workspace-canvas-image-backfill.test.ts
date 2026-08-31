import { describe, expect, it, vi } from "vitest";

import {
  isWorkspaceCanvasImageBackfillComplete,
  parseWorkspaceCanvasImageBackfillConcurrency,
  persistWorkspaceCanvasBackfillReplacement,
  runWorkspaceCanvasImageBackfill,
} from "./workspace-canvas-image-backfill";

describe("workspace canvas image backfill orchestration", () => {
  it("accepts an ambiguous completion only when reconciliation finds the final row", async () => {
    const discardUncommittedFinal = vi.fn().mockResolvedValue(undefined);
    const reconciledResult = { status: "completed" as const };

    await expect(
      persistWorkspaceCanvasBackfillReplacement({
        writeFinal: vi.fn().mockResolvedValue(undefined),
        complete: vi.fn().mockRejectedValue(new Error("connection lost")),
        reconcileAfterCompleteError: vi.fn().mockResolvedValue({
          status: "completed",
          result: reconciledResult,
        }),
        discardUncommittedFinal,
      }),
    ).resolves.toBe(reconciledResult);

    expect(discardUncommittedFinal).not.toHaveBeenCalled();
  });

  it("discards the final object when reconciliation finds the old row", async () => {
    const discardUncommittedFinal = vi.fn().mockResolvedValue(undefined);

    await expect(
      persistWorkspaceCanvasBackfillReplacement({
        writeFinal: vi.fn().mockResolvedValue(undefined),
        complete: vi.fn().mockRejectedValue(new Error("connection lost")),
        reconcileAfterCompleteError: vi
          .fn()
          .mockResolvedValue({ status: "not_persisted" }),
        discardUncommittedFinal,
      }),
    ).rejects.toThrow("connection lost");

    expect(discardUncommittedFinal).toHaveBeenCalledOnce();
  });

  it("fails closed when an ambiguous completion cannot be reconciled", async () => {
    const discardUncommittedFinal = vi.fn().mockResolvedValue(undefined);

    await expect(
      persistWorkspaceCanvasBackfillReplacement({
        writeFinal: vi.fn().mockResolvedValue(undefined),
        complete: vi.fn().mockRejectedValue(new Error("connection lost")),
        reconcileAfterCompleteError: vi
          .fn()
          .mockRejectedValue(new Error("reconciliation unavailable")),
        discardUncommittedFinal,
      }),
    ).rejects.toThrow("reconciliation unavailable");

    expect(discardUncommittedFinal).not.toHaveBeenCalled();
  });

  it("discards a final object when its write fails before completion", async () => {
    const discardUncommittedFinal = vi.fn().mockResolvedValue(undefined);

    await expect(
      persistWorkspaceCanvasBackfillReplacement({
        writeFinal: vi.fn().mockRejectedValue(new Error("storage failed")),
        complete: vi.fn(),
        reconcileAfterCompleteError: vi.fn(),
        discardUncommittedFinal,
      }),
    ).rejects.toThrow("storage failed");

    expect(discardUncommittedFinal).toHaveBeenCalledOnce();
  });

  it.each([
    [undefined, 2],
    ["invalid", 2],
    ["0", 1],
    ["1", 1],
    ["2", 2],
    ["4", 2],
  ])("normalizes concurrency %s to %i", (value, expected) => {
    expect(parseWorkspaceCanvasImageBackfillConcurrency(value)).toBe(expected);
  });

  it("processes the priority workspace first and caps concurrency at two", async () => {
    const calls: (string | undefined)[] = [];
    const batches = new Map<string | undefined, { id: number }[][]>([
      ["academia0001", [[{ id: 1 }, { id: 2 }], []]],
      [undefined, [[{ id: 3 }, { id: 4 }], [{ id: 5 }], [], []]],
    ]);
    let active = 0;
    let peak = 0;
    const summary = await runWorkspaceCanvasImageBackfill({
      concurrency: 2,
      priorityWorkspacePublicId: "academia0001",
      claimBatch: ({ workspacePublicId }) => {
        calls.push(workspacePublicId);
        return Promise.resolve(batches.get(workspacePublicId)?.shift() ?? []);
      },
      optimizeImage: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active -= 1;
        return "completed";
      },
      flushStorageDeletions: () => Promise.resolve(),
      countPendingStorageDeletions: () => Promise.resolve(0),
    });

    expect(calls[0]).toBe("academia0001");
    expect(calls.indexOf(undefined)).toBeGreaterThan(0);
    expect(peak).toBe(2);
    expect(summary).toEqual({
      completed: 5,
      stale: 0,
      failed: 0,
      remaining: 0,
      pendingStorage: 0,
    });
    expect(isWorkspaceCanvasImageBackfillComplete(summary)).toBe(true);
  });

  it("reports failed rows, remaining work and pending object cleanup", async () => {
    const onImageFailure = vi.fn();
    const claimBatch = vi
      .fn()
      .mockResolvedValueOnce([{ id: 1 }, { id: 2 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 2 }]);
    const summary = await runWorkspaceCanvasImageBackfill({
      concurrency: 2,
      claimBatch,
      optimizeImage: (image: { id: number }) =>
        image.id === 1
          ? Promise.resolve("stale")
          : Promise.reject(new Error("failed")),
      onImageFailure,
      flushStorageDeletions: () => Promise.resolve(),
      countPendingStorageDeletions: () => Promise.resolve(1),
    });

    expect(summary).toEqual({
      completed: 0,
      stale: 1,
      failed: 1,
      remaining: 1,
      pendingStorage: 1,
    });
    expect(isWorkspaceCanvasImageBackfillComplete(summary)).toBe(false);
    expect(onImageFailure).toHaveBeenCalledWith(
      { id: 2 },
      expect.objectContaining({ message: "failed" }),
    );
  });

  it("drains more than one storage cleanup batch", async () => {
    let pendingStorage = 251;
    const flushStorageDeletions = vi.fn(() => {
      pendingStorage = Math.max(0, pendingStorage - 250);
      return Promise.resolve();
    });

    const summary = await runWorkspaceCanvasImageBackfill({
      concurrency: 2,
      claimBatch: () => Promise.resolve([]),
      optimizeImage: () => Promise.resolve("completed"),
      flushStorageDeletions,
      countPendingStorageDeletions: () => Promise.resolve(pendingStorage),
    });

    expect(flushStorageDeletions).toHaveBeenCalledTimes(2);
    expect(summary.pendingStorage).toBe(0);
    expect(isWorkspaceCanvasImageBackfillComplete(summary)).toBe(true);
  });

  it("does not fail the release when the global pass recovers a priority failure", async () => {
    const attempts = new Map<number, number>();
    const batches = new Map<string | undefined, { id: number }[][]>([
      ["academia0001", [[{ id: 1 }], []]],
      [undefined, [[{ id: 1 }], [], []]],
    ]);
    const summary = await runWorkspaceCanvasImageBackfill({
      concurrency: 2,
      priorityWorkspacePublicId: "academia0001",
      claimBatch: ({ workspacePublicId }) =>
        Promise.resolve(batches.get(workspacePublicId)?.shift() ?? []),
      optimizeImage: (image) => {
        const attempt = (attempts.get(image.id) ?? 0) + 1;
        attempts.set(image.id, attempt);
        return attempt === 1
          ? Promise.reject(new Error("transient"))
          : Promise.resolve("completed");
      },
      flushStorageDeletions: () => Promise.resolve(),
      countPendingStorageDeletions: () => Promise.resolve(0),
    });

    expect(summary).toEqual({
      completed: 1,
      stale: 0,
      failed: 0,
      remaining: 0,
      pendingStorage: 0,
    });
    expect(isWorkspaceCanvasImageBackfillComplete(summary)).toBe(true);
  });
});
