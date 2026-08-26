import { describe, expect, it } from "vitest";

import type { WorkspaceCanvasDraft } from "./workspace-canvas-draft";
import {
  getLatestWorkspaceCanvasDraft,
  getWorkspaceCanvasDraftKey,
  resolveWorkspaceCanvasDraft,
} from "./workspace-canvas-draft";

const draft: WorkspaceCanvasDraft = {
  key: "user:workspace",
  userId: "user",
  workspacePublicId: "workspace001",
  baseVersion: 2,
  baseHash: "remote-hash",
  hash: "local-hash",
  scene: { elements: [], appState: {} },
  bytes: 36,
  elementCount: 0,
  updatedAt: 1,
  generation: "new-instance",
};

describe("resolveWorkspaceCanvasDraft", () => {
  it("restores a draft based on the current workspace head", () => {
    expect(resolveWorkspaceCanvasDraft(draft, 2, "remote-hash")).toEqual({
      kind: "draft",
      draft,
    });
  });

  it("marks a draft from an older workspace head as a conflict", () => {
    expect(resolveWorkspaceCanvasDraft(draft, 3, "new-hash")).toEqual({
      kind: "conflict",
      draft,
    });
  });

  it("isolates drafts by user and workspace", () => {
    expect(getWorkspaceCanvasDraftKey("user-a", "workspace-a")).toBe(
      "user-a:workspace-a",
    );
    expect(getWorkspaceCanvasDraftKey("user-b", "workspace-a")).not.toBe(
      getWorkspaceCanvasDraftKey("user-a", "workspace-a"),
    );
  });

  it("recovers the newest generation after a slow unmount handoff", () => {
    const reclaimed = {
      ...draft,
      hash: "latest-hash",
      updatedAt: 3,
      generation: "new-instance",
    };
    const lateFinalizer = {
      ...draft,
      key: "user:workspace:old-instance",
      updatedAt: 2,
      generation: "old-instance",
    };

    expect(
      getLatestWorkspaceCanvasDraft([draft, reclaimed, lateFinalizer]),
    ).toEqual(reclaimed);
  });

  it("uses a synced marker to mask an older divergent generation", () => {
    const olderDraft = {
      ...draft,
      hash: "unsaved-old-hash",
      updatedAt: 2,
      generation: "old-instance",
    };
    const syncedMarker = {
      ...draft,
      baseVersion: 3,
      baseHash: "saved-hash",
      hash: "saved-hash",
      updatedAt: 4,
      generation: "new-instance",
      synced: true,
    };

    expect(
      resolveWorkspaceCanvasDraft(
        getLatestWorkspaceCanvasDraft([olderDraft, syncedMarker]),
        3,
        "saved-hash",
      ),
    ).toEqual({ kind: "remote" });
  });

  it("ignores a clean marker when another editor advanced the remote head", () => {
    const syncedMarker = {
      ...draft,
      hash: "saved-v1",
      baseHash: "saved-v1",
      synced: true,
    };
    const localChange = {
      ...syncedMarker,
      hash: "local-change",
      synced: false,
    };

    expect(resolveWorkspaceCanvasDraft(syncedMarker, 3, "saved-v2")).toEqual({
      kind: "remote",
    });
    expect(resolveWorkspaceCanvasDraft(localChange, 3, "saved-v2")).toEqual({
      kind: "conflict",
      draft: localChange,
    });
  });
});
