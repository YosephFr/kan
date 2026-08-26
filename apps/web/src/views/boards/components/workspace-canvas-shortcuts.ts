import type { AppState } from "@excalidraw/excalidraw/types";

interface WorkspaceCanvasShortcutEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export const isWorkspaceCanvasGlobalShortcut = ({
  key,
  metaKey,
  ctrlKey,
  altKey,
  shiftKey,
}: WorkspaceCanvasShortcutEvent) => {
  const normalizedKey = key.toLowerCase();
  const commandModifier = metaKey || ctrlKey;
  if (commandModifier && !altKey && !shiftKey) {
    return normalizedKey === "k" || normalizedKey === "/";
  }
  return (
    !metaKey &&
    !ctrlKey &&
    !altKey &&
    !shiftKey &&
    (normalizedKey === "c" || normalizedKey === "g")
  );
};

type WorkspaceCanvasEscapeState = Pick<
  AppState,
  | "activeTool"
  | "contextMenu"
  | "croppingElementId"
  | "editingGroupId"
  | "editingLinearElement"
  | "editingTextElement"
  | "isCropping"
  | "isResizing"
  | "isRotating"
  | "multiElement"
  | "newElement"
  | "openDialog"
  | "openMenu"
  | "openPopup"
  | "openSidebar"
  | "pasteDialog"
  | "pendingImageElementId"
  | "resizingElement"
  | "selectedElementIds"
  | "selectedElementsAreBeingDragged"
  | "selectionElement"
  | "showHyperlinkPopup"
  | "stats"
>;

export const isWorkspaceCanvasEscapeNeutral = (
  appState: WorkspaceCanvasEscapeState | undefined,
  ui: {
    conflictOpen: boolean;
    detailsOpen: boolean;
    historyOpen: boolean;
  },
) =>
  Boolean(appState) &&
  appState?.activeTool.type === "selection" &&
  Object.keys(appState.selectedElementIds).length === 0 &&
  !appState.contextMenu &&
  !appState.croppingElementId &&
  !appState.editingGroupId &&
  !appState.editingLinearElement &&
  !appState.editingTextElement &&
  !appState.isCropping &&
  !appState.isResizing &&
  !appState.isRotating &&
  !appState.multiElement &&
  !appState.newElement &&
  !appState.openDialog &&
  !appState.openMenu &&
  !appState.openPopup &&
  !appState.openSidebar &&
  !appState.pasteDialog.shown &&
  !appState.pendingImageElementId &&
  !appState.resizingElement &&
  !appState.selectedElementsAreBeingDragged &&
  !appState.selectionElement &&
  !appState.showHyperlinkPopup &&
  !appState.stats.open &&
  !ui.conflictOpen &&
  !ui.detailsOpen &&
  !ui.historyOpen;
