import type { PoolClient } from "pg";

import type { dbClient } from "@kan/db/client";

const WORKSPACE_CANVAS_IMAGE_OPTIMIZATION_LOCK_NAMESPACE = 1_263_423_121;
const WORKSPACE_CANVAS_IMAGE_OPTIMIZATION_LOCK_SLOTS = [1, 2] as const;
const WORKSPACE_CANVAS_IMAGE_OPTIMIZATION_LOCK_WAIT_MS = 10_000;
const WORKSPACE_CANVAS_IMAGE_OPTIMIZATION_LOCK_POLL_MS = 50;

export class WorkspaceCanvasImageOptimizationSlotUnavailableError extends Error {
  constructor() {
    super("IMAGE_OPTIMIZATION_BUSY");
    this.name = "WorkspaceCanvasImageOptimizationSlotUnavailableError";
  }
}

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const connectWithTimeout = (
  db: dbClient,
  timeoutMs: number,
): Promise<PoolClient> =>
  new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      reject(new WorkspaceCanvasImageOptimizationSlotUnavailableError());
    }, timeoutMs);
    void db.$client.connect().then(
      (client) => {
        if (settled) {
          client.release();
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve(client);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new WorkspaceCanvasImageOptimizationSlotUnavailableError());
      },
    );
  });

export async function withWorkspaceCanvasImageGlobalOptimizationSlot<T>(
  db: dbClient,
  operation: () => Promise<T>,
  options: { waitTimeoutMs?: number; pollMs?: number } = {},
): Promise<T> {
  const pool = db.$client as unknown;
  if (
    pool === null ||
    typeof pool !== "object" ||
    !("connect" in pool) ||
    typeof pool.connect !== "function"
  ) {
    if (process.env.NODE_ENV === "production") {
      throw new WorkspaceCanvasImageOptimizationSlotUnavailableError();
    }
    return operation();
  }
  const waitTimeoutMs =
    options.waitTimeoutMs ?? WORKSPACE_CANVAS_IMAGE_OPTIMIZATION_LOCK_WAIT_MS;
  const pollMs =
    options.pollMs ?? WORKSPACE_CANVAS_IMAGE_OPTIMIZATION_LOCK_POLL_MS;
  const deadline = Date.now() + waitTimeoutMs;
  const client = await connectWithTimeout(db, waitTimeoutMs);
  let acquiredSlot: number | undefined;
  let destroyClient = false;
  try {
    while (Date.now() <= deadline) {
      for (const slot of WORKSPACE_CANVAS_IMAGE_OPTIMIZATION_LOCK_SLOTS) {
        let result: { rows: { acquired: boolean }[] };
        try {
          result = await client.query(
            "select pg_try_advisory_lock($1::integer, $2::integer) as acquired",
            [WORKSPACE_CANVAS_IMAGE_OPTIMIZATION_LOCK_NAMESPACE, slot],
          );
        } catch {
          destroyClient = true;
          throw new WorkspaceCanvasImageOptimizationSlotUnavailableError();
        }
        if (result.rows[0]?.acquired) {
          acquiredSlot = slot;
          break;
        }
      }
      if (acquiredSlot !== undefined) break;
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new WorkspaceCanvasImageOptimizationSlotUnavailableError();
      }
      await wait(Math.min(pollMs, remainingMs));
    }
    if (acquiredSlot === undefined) {
      throw new WorkspaceCanvasImageOptimizationSlotUnavailableError();
    }
    return await operation();
  } finally {
    if (acquiredSlot !== undefined) {
      try {
        const result = await client.query<{ released: boolean }>(
          "select pg_advisory_unlock($1::integer, $2::integer) as released",
          [WORKSPACE_CANVAS_IMAGE_OPTIMIZATION_LOCK_NAMESPACE, acquiredSlot],
        );
        destroyClient = result.rows[0]?.released !== true;
      } catch {
        destroyClient = true;
      }
    }
    client.release(destroyClient);
  }
}
