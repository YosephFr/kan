import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

export const activateCardCanvasPen = (
  api: ExcalidrawImperativeAPI,
  isFirstPenPointer = !api.getAppState().penDetected,
) => {
  const appState = api.getAppState();
  api.updateScene({
    appState: {
      penMode: true,
      penDetected: true,
    },
  });
  if (isFirstPenPointer && appState.activeTool.type === "selection") {
    api.setActiveTool({ type: "freedraw" });
  }
};

export const detectFirstCardCanvasPenPointer = (state: {
  current: boolean;
}) => {
  const isFirstPenPointer = !state.current;
  state.current = true;
  return isFirstPenPointer;
};

export function useCardCanvasPen({
  api,
  canEdit,
  preferenceKey,
}: {
  api: ExcalidrawImperativeAPI | null;
  canEdit: boolean;
  preferenceKey: string;
}) {
  const [enabled, setEnabled] = useState(false);
  const [preferenceReady, setPreferenceReady] = useState(false);
  const penPointerDetectedRef = useRef(false);

  useEffect(() => {
    penPointerDetectedRef.current = false;
  }, [api, preferenceKey]);

  useEffect(() => {
    setPreferenceReady(false);
    try {
      setEnabled(window.localStorage.getItem(preferenceKey) === "true");
    } catch {
      setEnabled(false);
    }
    setPreferenceReady(true);
  }, [preferenceKey]);

  useEffect(() => {
    if (!preferenceReady) return;
    try {
      window.localStorage.setItem(preferenceKey, String(enabled));
    } catch {
      return;
    }
  }, [enabled, preferenceKey, preferenceReady]);

  useEffect(() => {
    if (!api || !canEdit) return;
    api.updateScene({
      appState: {
        penMode: enabled,
        penDetected: enabled || api.getAppState().penDetected,
      },
    });
  }, [api, canEdit, enabled]);

  const toggle = useCallback(() => setEnabled((current) => !current), []);
  const handlePointerDownCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== "pen" || !api || !canEdit) return;
      const isFirstPenPointer = detectFirstCardCanvasPenPointer(
        penPointerDetectedRef,
      );
      activateCardCanvasPen(api, isFirstPenPointer);
      setEnabled(true);
    },
    [api, canEdit],
  );

  return { enabled, toggle, handlePointerDownCapture };
}
