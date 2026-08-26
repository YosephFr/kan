import { describe, expect, it } from "vitest";

import {
  isWorkspaceCanvasEscapeNeutral,
  isWorkspaceCanvasGlobalShortcut,
} from "./workspace-canvas-shortcuts";

const event = (key: string, modifiers = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...modifiers,
});

describe("isWorkspaceCanvasGlobalShortcut", () => {
  it("blocks board creation and global navigation prefixes", () => {
    expect(isWorkspaceCanvasGlobalShortcut(event("c"))).toBe(true);
    expect(isWorkspaceCanvasGlobalShortcut(event("G"))).toBe(true);
  });

  it("blocks global command and shortcut menus on macOS and iPad keyboards", () => {
    expect(isWorkspaceCanvasGlobalShortcut(event("k", { metaKey: true }))).toBe(
      true,
    );
    expect(isWorkspaceCanvasGlobalShortcut(event("/", { ctrlKey: true }))).toBe(
      true,
    );
  });

  it("leaves Excalidraw editing shortcuts untouched", () => {
    expect(isWorkspaceCanvasGlobalShortcut(event("v"))).toBe(false);
    expect(isWorkspaceCanvasGlobalShortcut(event("z", { metaKey: true }))).toBe(
      false,
    );
    expect(isWorkspaceCanvasGlobalShortcut(event("c", { metaKey: true }))).toBe(
      false,
    );
  });
});

describe("isWorkspaceCanvasEscapeNeutral", () => {
  const neutral = {
    activeTool: { type: "selection" },
    contextMenu: null,
    croppingElementId: null,
    editingGroupId: null,
    editingLinearElement: null,
    editingTextElement: null,
    isCropping: false,
    isResizing: false,
    isRotating: false,
    multiElement: null,
    newElement: null,
    openDialog: null,
    openMenu: null,
    openPopup: null,
    openSidebar: null,
    pasteDialog: { shown: false, data: null },
    pendingImageElementId: null,
    resizingElement: null,
    selectedElementIds: {},
    selectedElementsAreBeingDragged: false,
    selectionElement: null,
    showHyperlinkPopup: false,
    stats: { open: false, panels: 0 },
  } as const;
  const ui = { conflictOpen: false, detailsOpen: false, historyOpen: false };

  it("exits only from a neutral selection state", () => {
    expect(isWorkspaceCanvasEscapeNeutral(neutral as never, ui)).toBe(true);
    expect(
      isWorkspaceCanvasEscapeNeutral(
        { ...neutral, activeTool: { type: "freedraw" } } as never,
        ui,
      ),
    ).toBe(false);
    expect(
      isWorkspaceCanvasEscapeNeutral(
        { ...neutral, newElement: { id: "drawing" } } as never,
        ui,
      ),
    ).toBe(false);
  });

  it("lets Excalidraw and workspace UI close their own layers first", () => {
    expect(
      isWorkspaceCanvasEscapeNeutral(
        { ...neutral, openPopup: "elementStroke" } as never,
        ui,
      ),
    ).toBe(false);
    expect(
      isWorkspaceCanvasEscapeNeutral(neutral as never, {
        ...ui,
        historyOpen: true,
      }),
    ).toBe(false);
  });
});
