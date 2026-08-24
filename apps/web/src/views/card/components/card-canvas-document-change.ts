interface CardCanvasDocumentAppState {
  viewBackgroundColor?: string;
  gridSize?: number | null;
  gridStep?: number | null;
  gridModeEnabled?: boolean;
  objectsSnapModeEnabled?: boolean;
}

export interface CardCanvasDocumentSnapshot extends CardCanvasDocumentAppState {
  elements: readonly unknown[];
}

export const captureCardCanvasDocument = (
  elements: readonly unknown[],
  appState: CardCanvasDocumentAppState,
): CardCanvasDocumentSnapshot => ({
  elements,
  viewBackgroundColor: appState.viewBackgroundColor,
  gridSize: appState.gridSize,
  gridStep: appState.gridStep,
  gridModeEnabled: appState.gridModeEnabled,
  objectsSnapModeEnabled: appState.objectsSnapModeEnabled,
});

export const seedCardCanvasDocumentSnapshot = (
  currentSnapshot: CardCanvasDocumentSnapshot | null,
  currentKey: string | null,
  nextKey: string,
  elements: readonly unknown[],
  appState: CardCanvasDocumentAppState,
) =>
  currentSnapshot !== null && currentKey === nextKey
    ? { key: currentKey, snapshot: currentSnapshot }
    : {
        key: nextKey,
        snapshot: captureCardCanvasDocument(elements, appState),
      };

export const hasCardCanvasDocumentChanged = (
  previous: CardCanvasDocumentSnapshot | null,
  elements: readonly unknown[],
  appState: CardCanvasDocumentAppState,
) =>
  previous === null ||
  (previous.elements !== elements &&
    (previous.elements.length > 0 || elements.length > 0)) ||
  previous.viewBackgroundColor !== appState.viewBackgroundColor ||
  previous.gridSize !== appState.gridSize ||
  previous.gridStep !== appState.gridStep ||
  previous.gridModeEnabled !== appState.gridModeEnabled ||
  previous.objectsSnapModeEnabled !== appState.objectsSnapModeEnabled;
