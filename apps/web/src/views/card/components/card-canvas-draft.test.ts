import { describe, expect, it } from "vitest";

import type { CardCanvasDraft } from "./card-canvas-types";
import {
  getCardCanvasDraftKey,
  resolveCardCanvasDraft,
} from "./card-canvas-draft";

const draft: CardCanvasDraft = {
  key: "user:card",
  userId: "user",
  cardPublicId: "abc123def456",
  baseVersion: 3,
  baseHash: "remote-hash",
  hash: "local-hash",
  scene: { elements: [], appState: {} },
  bytes: 36,
  elementCount: 0,
  updatedAt: 1,
};

describe("resolveCardCanvasDraft", () => {
  it("restores a draft based on the current remote head", () => {
    expect(resolveCardCanvasDraft(draft, 3, "remote-hash")).toEqual({
      kind: "draft",
      draft,
    });
  });

  it("marks a draft from an older remote head as a conflict", () => {
    expect(resolveCardCanvasDraft(draft, 4, "new-hash")).toEqual({
      kind: "conflict",
      draft,
    });
  });

  it("ignores an already-synchronised draft", () => {
    expect(
      resolveCardCanvasDraft(
        { ...draft, hash: "remote-hash" },
        3,
        "remote-hash",
      ),
    ).toEqual({ kind: "remote" });
  });
});

describe("getCardCanvasDraftKey", () => {
  it("isolates drafts by user and card", () => {
    expect(getCardCanvasDraftKey("user-a", "card-a")).toBe("user-a:card-a");
    expect(getCardCanvasDraftKey("user-b", "card-a")).not.toBe(
      getCardCanvasDraftKey("user-a", "card-a"),
    );
  });
});
