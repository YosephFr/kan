import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

import type { CardCanvasElement, CardCanvasScene } from "./card-canvas-types";
import { ensureCanvasFramePublicIds } from "./card-canvas-elements";

export const toCardCanvasScene = (
  elements: readonly ExcalidrawElement[],
  appState: AppState,
) => {
  const withFramePublicIds = ensureCanvasFramePublicIds(
    elements as unknown as CardCanvasElement[],
  );
  const scene: CardCanvasScene = {
    elements: withFramePublicIds.elements,
    appState: {
      viewBackgroundColor: appState.viewBackgroundColor,
      gridSize: appState.gridSize,
      gridStep: appState.gridStep,
      gridModeEnabled: appState.gridModeEnabled,
      objectsSnapModeEnabled: appState.objectsSnapModeEnabled,
    },
  };
  return { ...withFramePublicIds, scene };
};

export const toExcalidrawAppState = (
  appState: CardCanvasScene["appState"],
): Pick<
  AppState,
  | "viewBackgroundColor"
  | "gridSize"
  | "gridStep"
  | "gridModeEnabled"
  | "objectsSnapModeEnabled"
> => ({
  viewBackgroundColor: appState.viewBackgroundColor ?? "#ffffff",
  gridSize: appState.gridSize ?? 20,
  gridStep: appState.gridStep ?? 5,
  gridModeEnabled: appState.gridModeEnabled ?? false,
  objectsSnapModeEnabled: appState.objectsSnapModeEnabled ?? false,
});
