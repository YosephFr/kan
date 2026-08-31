export interface WorkspaceCanvasImageBackfillItem {
  id: number;
  publicId?: string;
}

export const parseWorkspaceCanvasImageBackfillConcurrency = (
  value: string | undefined,
) => {
  const parsed = Number.parseInt(value ?? "2", 10);
  return Number.isInteger(parsed) ? Math.max(1, Math.min(parsed, 2)) : 2;
};

export interface WorkspaceCanvasImageBackfillSummary {
  completed: number;
  stale: number;
  failed: number;
  remaining: number;
  pendingStorage: number;
}

export async function persistWorkspaceCanvasBackfillReplacement<Result>({
  writeFinal,
  complete,
  reconcileAfterCompleteError,
  discardUncommittedFinal,
}: {
  writeFinal: () => Promise<void>;
  complete: () => Promise<Result>;
  reconcileAfterCompleteError: () => Promise<
    | { status: "completed"; result: NoInfer<Result> }
    | { status: "not_persisted" }
  >;
  discardUncommittedFinal: () => Promise<void>;
}): Promise<Result> {
  try {
    await writeFinal();
  } catch (error) {
    await discardUncommittedFinal();
    throw error;
  }
  try {
    return await complete();
  } catch (error) {
    const reconciliation = await reconcileAfterCompleteError();
    if (reconciliation.status === "completed") {
      return reconciliation.result;
    }
    await discardUncommittedFinal();
    throw error;
  }
}

export async function drainWorkspaceCanvasImageStorageDeletions({
  flushStorageDeletions,
  countPendingStorageDeletions,
}: {
  flushStorageDeletions: () => Promise<void>;
  countPendingStorageDeletions: () => Promise<number>;
}) {
  let pendingStorage = await countPendingStorageDeletions();
  for (let pass = 0; pass < 100 && pendingStorage > 0; pass += 1) {
    await flushStorageDeletions();
    const remainingStorage = await countPendingStorageDeletions();
    if (remainingStorage >= pendingStorage) break;
    pendingStorage = remainingStorage;
  }
  return pendingStorage;
}

export async function runWorkspaceCanvasImageBackfill<
  T extends WorkspaceCanvasImageBackfillItem,
>({
  concurrency,
  priorityWorkspacePublicId,
  claimBatch,
  optimizeImage,
  onImageFailure,
  flushStorageDeletions,
  countPendingStorageDeletions,
}: {
  concurrency: number;
  priorityWorkspacePublicId?: string;
  claimBatch: (input: {
    afterId?: number;
    limit: number;
    workspacePublicId?: string;
  }) => Promise<T[]>;
  optimizeImage: (image: T) => Promise<"completed" | "stale">;
  onImageFailure?: (image: T, error: unknown) => void;
  flushStorageDeletions: () => Promise<void>;
  countPendingStorageDeletions: () => Promise<number>;
}): Promise<WorkspaceCanvasImageBackfillSummary> {
  const summary: WorkspaceCanvasImageBackfillSummary = {
    completed: 0,
    stale: 0,
    failed: 0,
    remaining: 0,
    pendingStorage: 0,
  };
  const completedIds = new Set<number>();
  const staleIds = new Set<number>();
  const failedIds = new Set<number>();
  const runPass = async (workspacePublicId?: string) => {
    let afterId = 0;
    while (true) {
      const images = await claimBatch({
        afterId,
        limit: concurrency,
        workspacePublicId,
      });
      if (images.length === 0) break;
      afterId = Math.max(...images.map((image) => image.id));
      const results = await Promise.allSettled(images.map(optimizeImage));
      for (const [index, result] of results.entries()) {
        const image = images[index];
        if (!image) continue;
        if (result.status === "rejected") {
          failedIds.add(image.id);
          onImageFailure?.(image, result.reason);
        } else if (result.value === "completed") {
          failedIds.delete(image.id);
          staleIds.delete(image.id);
          completedIds.add(image.id);
        } else {
          failedIds.delete(image.id);
          completedIds.delete(image.id);
          staleIds.add(image.id);
        }
      }
    }
  };

  if (priorityWorkspacePublicId) {
    await runPass(priorityWorkspacePublicId);
  }
  await runPass();
  summary.completed = completedIds.size;
  summary.stale = staleIds.size;
  summary.failed = failedIds.size;
  summary.remaining = (await claimBatch({ limit: 1 })).length;
  summary.pendingStorage = await drainWorkspaceCanvasImageStorageDeletions({
    flushStorageDeletions,
    countPendingStorageDeletions,
  });
  return summary;
}

export const isWorkspaceCanvasImageBackfillComplete = (
  summary: WorkspaceCanvasImageBackfillSummary,
) =>
  summary.failed === 0 &&
  summary.remaining === 0 &&
  summary.pendingStorage === 0;
