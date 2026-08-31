import { afterEach, describe, expect, it, vi } from "vitest";

import type { dbClient } from "@kan/db/client";

import {
  withWorkspaceCanvasImageGlobalOptimizationSlot,
  WorkspaceCanvasImageOptimizationSlotUnavailableError,
} from "./workspace-canvas-image-optimization-slot";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
};

const createSharedAdvisoryLockCluster = () => {
  const heldSlots = new Set<number>();
  const createDb = () => {
    const connect = vi.fn(() => {
      const ownedSlots = new Set<number>();
      return Promise.resolve({
        query: vi.fn((query: string, values: readonly number[]) => {
          const slot = values[1];
          if (slot === undefined) throw new Error("Missing advisory lock slot");
          if (query.includes("pg_try_advisory_lock")) {
            if (heldSlots.has(slot)) {
              return Promise.resolve({ rows: [{ acquired: false }] });
            }
            heldSlots.add(slot);
            ownedSlots.add(slot);
            return Promise.resolve({ rows: [{ acquired: true }] });
          }
          const released = ownedSlots.delete(slot);
          if (released) heldSlots.delete(slot);
          return Promise.resolve({ rows: [{ released }] });
        }),
        release: vi.fn((destroy?: boolean) => {
          if (!destroy) return;
          for (const slot of ownedSlots) heldSlots.delete(slot);
          ownedSlots.clear();
        }),
      });
    });
    return { $client: { connect } } as unknown as dbClient;
  };
  return { createDb };
};

describe("workspace canvas image global optimization slots", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the local guard for PGlite outside production", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const operation = vi.fn(() => Promise.resolve("local"));

    await expect(
      withWorkspaceCanvasImageGlobalOptimizationSlot(
        { $client: {} } as dbClient,
        operation,
      ),
    ).resolves.toBe("local");
    expect(operation).toHaveBeenCalledOnce();
  });

  it("fails closed when production has no PostgreSQL pool", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const operation = vi.fn(() => Promise.resolve("unsafe"));

    await expect(
      withWorkspaceCanvasImageGlobalOptimizationSlot(
        { $client: {} } as dbClient,
        operation,
      ),
    ).rejects.toEqual(
      new WorkspaceCanvasImageOptimizationSlotUnavailableError(),
    );
    expect(operation).not.toHaveBeenCalled();
  });

  it("keeps the combined peak at two across independent pools", async () => {
    const cluster = createSharedAdvisoryLockCluster();
    const gates = [deferred(), deferred(), deferred()];
    let active = 0;
    let peak = 0;
    const run = (db: dbClient, index: number) =>
      withWorkspaceCanvasImageGlobalOptimizationSlot(
        db,
        async () => {
          active += 1;
          peak = Math.max(peak, active);
          await gates[index]?.promise;
          active -= 1;
          return index;
        },
        { waitTimeoutMs: 1_000, pollMs: 1 },
      );

    const operations = [
      run(cluster.createDb(), 0),
      run(cluster.createDb(), 1),
      run(cluster.createDb(), 2),
    ];
    await vi.waitFor(() => expect(active).toBe(2));
    expect(peak).toBe(2);

    gates[0]?.resolve();
    await expect(operations[0]).resolves.toBe(0);
    await vi.waitFor(() => expect(active).toBe(2));
    expect(peak).toBe(2);

    gates[1]?.resolve();
    gates[2]?.resolve();
    await expect(Promise.all(operations)).resolves.toEqual([0, 1, 2]);
    expect(peak).toBe(2);
  });

  it("times out without a global slot and recovers after release", async () => {
    const cluster = createSharedAdvisoryLockCluster();
    const firstGate = deferred();
    const secondGate = deferred();
    let active = 0;
    const first = withWorkspaceCanvasImageGlobalOptimizationSlot(
      cluster.createDb(),
      () => {
        active += 1;
        return firstGate.promise.finally(() => {
          active -= 1;
        });
      },
    );
    const second = withWorkspaceCanvasImageGlobalOptimizationSlot(
      cluster.createDb(),
      () => {
        active += 1;
        return secondGate.promise.finally(() => {
          active -= 1;
        });
      },
    );
    await vi.waitFor(() => expect(active).toBe(2));

    await expect(
      withWorkspaceCanvasImageGlobalOptimizationSlot(
        cluster.createDb(),
        () => Promise.resolve("blocked"),
        { waitTimeoutMs: 5, pollMs: 1 },
      ),
    ).rejects.toEqual(
      new WorkspaceCanvasImageOptimizationSlotUnavailableError(),
    );

    firstGate.resolve();
    secondGate.resolve();
    await Promise.all([first, second]);
    await expect(
      withWorkspaceCanvasImageGlobalOptimizationSlot(
        cluster.createDb(),
        () => Promise.resolve("recovered"),
        { waitTimeoutMs: 20, pollMs: 1 },
      ),
    ).resolves.toBe("recovered");
  });
});
