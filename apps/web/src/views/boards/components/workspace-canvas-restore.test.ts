import { describe, expect, it, vi } from "vitest";

import { restoreWorkspaceCanvasRevision } from "./workspace-canvas-restore";

describe("restoreWorkspaceCanvasRevision", () => {
  it("does not synchronize when the server commit fails", async () => {
    const synchronizeRemote = vi.fn();
    const refreshHistory = vi.fn();

    await expect(
      restoreWorkspaceCanvasRevision({
        commit: () => Promise.reject(new Error("RESTORE_FAILED")),
        synchronizeRemote,
        refreshHistory,
      }),
    ).rejects.toThrow("RESTORE_FAILED");

    expect(synchronizeRemote).not.toHaveBeenCalled();
    expect(refreshHistory).not.toHaveBeenCalled();
  });

  it("reports a CAS conflict without changing the local scene", async () => {
    const synchronizeRemote = vi.fn();

    const result = await restoreWorkspaceCanvasRevision({
      commit: () =>
        Promise.resolve({ status: "conflict" as const, remoteVersion: 7 }),
      synchronizeRemote,
      refreshHistory: vi.fn(),
    });

    expect(result).toEqual({ status: "conflict", remoteVersion: 7 });
    expect(synchronizeRemote).not.toHaveBeenCalled();
  });

  it("blocks stale local saving when post-commit synchronization fails", async () => {
    const refreshHistory = vi.fn();

    const result = await restoreWorkspaceCanvasRevision({
      commit: () => Promise.resolve({ status: "saved" as const, version: 8 }),
      synchronizeRemote: () => Promise.resolve(false),
      refreshHistory,
    });

    expect(result).toEqual({ status: "restored-sync-failed", version: 8 });
    expect(refreshHistory).not.toHaveBeenCalled();
  });

  it("keeps a committed restore successful when history refresh fails", async () => {
    const order: string[] = [];

    const result = await restoreWorkspaceCanvasRevision({
      commit: () => {
        order.push("commit");
        return Promise.resolve({ status: "saved" as const, version: 9 });
      },
      synchronizeRemote: () => {
        order.push("synchronize");
        return Promise.resolve(true);
      },
      refreshHistory: () => {
        order.push("history");
        return Promise.reject(new Error("HISTORY_FAILED"));
      },
    });

    expect(result).toEqual({ status: "restored", version: 9 });
    expect(order).toEqual(["commit", "synchronize", "history"]);
  });
});
