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

export const hasCardCanvasDocumentChanged = (
  previous: CardCanvasDocumentSnapshot | null,
  elements: readonly unknown[],
  appState: CardCanvasDocumentAppState,
) =>
  previous === null ||
  previous.elements !== elements ||
  previous.viewBackgroundColor !== appState.viewBackgroundColor ||
  previous.gridSize !== appState.gridSize ||
  previous.gridStep !== appState.gridStep ||
  previous.gridModeEnabled !== appState.gridModeEnabled ||
  previous.objectsSnapModeEnabled !== appState.objectsSnapModeEnabled;
