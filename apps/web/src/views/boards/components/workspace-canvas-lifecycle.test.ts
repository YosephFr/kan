import { describe, expect, it, vi } from "vitest";

import type { NormalizedCardCanvas } from "~/views/card/components/card-canvas-types";
import {
  canInitializeWorkspaceCanvas,
  canPersistWorkspaceCanvasDraft,
  getWorkspaceCanvasBlockingError,
  getWorkspaceCanvasReconnectAction,
  preserveWorkspaceCanvasOnUnmount,
  replaceWorkspaceCanvasWithRemote,
} from "./workspace-canvas-lifecycle";

describe("canInitializeWorkspaceCanvas", () => {
  it("waits for the editor identity before claiming its local draft", () => {
    expect(canInitializeWorkspaceCanvas(true, null)).toBe(false);
    expect(canInitializeWorkspaceCanvas(true, "user-1")).toBe(true);
    expect(canInitializeWorkspaceCanvas(false, null)).toBe(true);
  });
});

describe("canPersistWorkspaceCanvasDraft", () => {
  it("keeps an existing dirty draft recoverable after edit access is revoked", () => {
    expect(canPersistWorkspaceCanvasDraft("user-1", false, true)).toBe(true);
    expect(canPersistWorkspaceCanvasDraft("user-1", false, false)).toBe(false);
  });

  it("never persists a workspace draft without an authenticated owner", () => {
    expect(canPersistWorkspaceCanvasDraft(null, true, true)).toBe(false);
  });
});

const normalized: NormalizedCardCanvas = {
  requestId: 1,
  scene: { elements: [], appState: {} },
  serialized: "{}",
  hash: "local-hash",
  bytes: 2,
  elementCount: 0,
  errors: [],
};

describe("preserveWorkspaceCanvasOnUnmount", () => {
  it("falls back to a server CAS save before disposing when local persistence fails", async () => {
    const order: string[] = [];
    const flushServer = vi.fn(() => {
      order.push("server");
      return Promise.resolve();
    });

    await preserveWorkspaceCanvasOnUnmount({
      persistDraft: () => {
        order.push("indexed-db");
        return Promise.resolve({
          normalized,
          localPersisted: false,
          isCurrent: true,
        });
      },
      canFlushServer: () => true,
      flushServer,
      dispose: () => order.push("dispose"),
    });

    expect(flushServer).toHaveBeenCalledWith(normalized);
    expect(order).toEqual(["indexed-db", "server", "dispose"]);
  });

  it("does not save without a verified remote head", async () => {
    const flushServer = vi.fn();
    const dispose = vi.fn();

    await preserveWorkspaceCanvasOnUnmount({
      persistDraft: () =>
        Promise.resolve({
          normalized,
          localPersisted: false,
          isCurrent: true,
        }),
      canFlushServer: () => false,
      flushServer,
      dispose,
    });

    expect(flushServer).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("keeps the local draft as the first recovery path", async () => {
    const flushServer = vi.fn();

    await preserveWorkspaceCanvasOnUnmount({
      persistDraft: () =>
        Promise.resolve({
          normalized,
          localPersisted: true,
          isCurrent: true,
        }),
      canFlushServer: () => true,
      flushServer,
      dispose: vi.fn(),
    });

    expect(flushServer).not.toHaveBeenCalled();
  });

  it("persists locally but never flushes after edit access is revoked", async () => {
    const writeLocalDraft = vi.fn(() => Promise.resolve(true));
    const flushServer = vi.fn();

    await preserveWorkspaceCanvasOnUnmount({
      persistDraft: async () => {
        if (!canPersistWorkspaceCanvasDraft("user-1", false, true)) {
          return null;
        }
        return {
          normalized,
          localPersisted: await writeLocalDraft(),
          isCurrent: true,
        };
      },
      canFlushServer: () => false,
      flushServer,
      dispose: vi.fn(),
    });

    expect(writeLocalDraft).toHaveBeenCalledOnce();
    expect(flushServer).not.toHaveBeenCalled();
  });

  it("retries a superseded IndexedDB write before disposing", async () => {
    const persistDraft = vi
      .fn()
      .mockResolvedValueOnce({
        normalized,
        localPersisted: true,
        isCurrent: false,
      })
      .mockResolvedValueOnce({
        normalized,
        localPersisted: true,
        isCurrent: true,
      });

    await preserveWorkspaceCanvasOnUnmount({
      persistDraft,
      canFlushServer: () => true,
      flushServer: vi.fn(),
      dispose: vi.fn(),
    });

    expect(persistDraft).toHaveBeenCalledTimes(2);
  });
});

describe("replaceWorkspaceCanvasWithRemote", () => {
  it("does not discard the local draft when applying the remote scene fails", async () => {
    const discardLocalDraft = vi.fn();
    const persistRemoteDraft = vi.fn();

    await expect(
      replaceWorkspaceCanvasWithRemote({
        applyRemote: () => Promise.reject(new Error("NORMALIZATION_FAILED")),
        discardLocalDraft,
        persistRemoteDraft,
      }),
    ).rejects.toThrow("NORMALIZATION_FAILED");

    expect(discardLocalDraft).not.toHaveBeenCalled();
    expect(persistRemoteDraft).not.toHaveBeenCalled();
  });

  it("does not discard the draft when the remote result became stale", async () => {
    const discardLocalDraft = vi.fn();
    const persistRemoteDraft = vi.fn();

    const result = await replaceWorkspaceCanvasWithRemote({
      applyRemote: () => Promise.resolve(false),
      discardLocalDraft,
      persistRemoteDraft,
    });

    expect(result).toBe("not-applied");
    expect(discardLocalDraft).not.toHaveBeenCalled();
    expect(persistRemoteDraft).not.toHaveBeenCalled();
  });

  it("applies remote content before replacing the local draft", async () => {
    const order: string[] = [];

    const result = await replaceWorkspaceCanvasWithRemote({
      applyRemote: () => {
        order.push("apply-remote");
        return Promise.resolve(true);
      },
      discardLocalDraft: () => {
        order.push("discard-local");
        return Promise.resolve();
      },
      persistRemoteDraft: () => {
        order.push("persist-remote");
        return Promise.resolve(true);
      },
    });

    expect(result).toBe("persisted");
    expect(order).toEqual(["apply-remote", "discard-local", "persist-remote"]);
  });

  it("preserves the prior draft if replacing local storage fails", async () => {
    const persistRemoteDraft = vi.fn();

    const result = await replaceWorkspaceCanvasWithRemote({
      applyRemote: () => Promise.resolve(true),
      discardLocalDraft: () => Promise.reject(new Error("IDB_FAILED")),
      persistRemoteDraft,
    });

    expect(result).toBe("draft-preserved");
    expect(persistRemoteDraft).not.toHaveBeenCalled();
  });
});

describe("getWorkspaceCanvasReconnectAction", () => {
  it("refreshes and compares the remote head before flushing an offline draft", () => {
    expect(
      getWorkspaceCanvasReconnectAction({
        remoteHeadVerified: false,
        isDirty: true,
        hasConflict: false,
      }),
    ).toBe("refresh-head");
  });

  it("flushes only after the current remote head has been verified", () => {
    expect(
      getWorkspaceCanvasReconnectAction({
        remoteHeadVerified: true,
        isDirty: true,
        hasConflict: false,
      }),
    ).toBe("flush");
    expect(
      getWorkspaceCanvasReconnectAction({
        remoteHeadVerified: true,
        isDirty: true,
        hasConflict: true,
      }),
    ).toBe("wait");
  });
});

describe("getWorkspaceCanvasBlockingError", () => {
  it("keeps a recovered IndexedDB scene visible when the query fails online", () => {
    const queryError = new Error("NETWORK_UNREACHABLE");

    expect(
      getWorkspaceCanvasBlockingError(
        { elements: [], appState: {} },
        queryError,
      ),
    ).toBeNull();
    expect(getWorkspaceCanvasBlockingError(null, queryError)).toBe(queryError);
  });
});
