import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useCallback, useRef, useState } from "react";

export type CardCanvasEscapeAction =
  | "defer"
  | "details"
  | "zones"
  | "resources"
  | "history"
  | "extended"
  | null;

export const getCardCanvasEscapeAction = ({
  hasBlockingDialog,
  hasOpenDetails,
  zonesOpen,
  resourcesOpen,
  historyOpen,
  isExcalidrawBusy,
  extended,
}: {
  hasBlockingDialog: boolean;
  hasOpenDetails: boolean;
  zonesOpen: boolean;
  resourcesOpen: boolean;
  historyOpen: boolean;
  isExcalidrawBusy: boolean;
  extended: boolean;
}): CardCanvasEscapeAction => {
  if (hasBlockingDialog) return "defer";
  if (hasOpenDetails) return "details";
  if (zonesOpen) return "zones";
  if (resourcesOpen) return "resources";
  if (historyOpen) return "history";
  if (isExcalidrawBusy) return "defer";
  if (extended) return "extended";
  return null;
};

export function useCardCanvasDrawers({
  api,
  extended,
  hasOpenDialog,
  onExtendedChange,
}: {
  api: ExcalidrawImperativeAPI | null;
  extended: boolean;
  hasOpenDialog: boolean;
  onExtendedChange: (extended: boolean) => void;
}) {
  const [zonesOpen, setZonesOpen] = useState(false);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const drawerTriggerRef = useRef<HTMLElement | null>(null);

  const restoreFocus = useCallback(() => {
    window.requestAnimationFrame(() => drawerTriggerRef.current?.focus());
  }, []);
  const closeZones = useCallback(() => {
    setZonesOpen(false);
    restoreFocus();
  }, [restoreFocus]);
  const closeResources = useCallback(() => {
    setResourcesOpen(false);
    restoreFocus();
  }, [restoreFocus]);
  const closeHistory = useCallback(() => {
    setHistoryOpen(false);
    restoreFocus();
  }, [restoreFocus]);

  const rememberTrigger = useCallback(() => {
    if (!(document.activeElement instanceof HTMLElement)) return;
    const details = document.activeElement.closest("details");
    drawerTriggerRef.current =
      details?.querySelector<HTMLElement>("summary") ?? document.activeElement;
  }, []);
  const focusDrawer = useCallback((drawerId: string) => {
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`#${drawerId} button`)?.focus();
    });
  }, []);

  const toggleZones = useCallback(() => {
    if (zonesOpen) return closeZones();
    rememberTrigger();
    setZonesOpen(true);
    setResourcesOpen(false);
    setHistoryOpen(false);
    focusDrawer("card-canvas-zones-drawer");
  }, [closeZones, focusDrawer, rememberTrigger, zonesOpen]);
  const toggleResources = useCallback(() => {
    if (resourcesOpen) return closeResources();
    rememberTrigger();
    setResourcesOpen(true);
    setZonesOpen(false);
    setHistoryOpen(false);
    focusDrawer("card-canvas-resources-drawer");
  }, [closeResources, focusDrawer, rememberTrigger, resourcesOpen]);
  const toggleHistory = useCallback(() => {
    if (historyOpen) return closeHistory();
    rememberTrigger();
    setHistoryOpen(true);
    setZonesOpen(false);
    setResourcesOpen(false);
    focusDrawer("card-canvas-history-drawer");
  }, [closeHistory, focusDrawer, rememberTrigger, historyOpen]);

  const handleKeyDownCapture = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key !== "Escape") return;
      const appState = api?.getAppState();
      const target = event.target;
      const details =
        event.currentTarget.querySelector<HTMLDetailsElement>("details[open]");
      const action = getCardCanvasEscapeAction({
        hasBlockingDialog:
          hasOpenDialog ||
          (target instanceof Element &&
            Boolean(target.closest('[role="dialog"]'))),
        hasOpenDetails: Boolean(details),
        zonesOpen,
        resourcesOpen,
        historyOpen,
        isExcalidrawBusy: [
          appState?.editingTextElement,
          appState?.editingFrame,
          appState?.editingLinearElement,
          appState?.multiElement,
          appState?.croppingElementId,
          appState?.openDialog,
          appState?.openMenu,
          appState?.openPopup,
          appState?.contextMenu,
          appState?.pasteDialog.shown,
          appState?.showHyperlinkPopup,
          appState?.openSidebar,
        ].some(Boolean),
        extended,
      });
      if (action === "defer" || action === null) return;
      if (action === "details" && details) {
        details.open = false;
        details.querySelector<HTMLElement>("summary")?.focus();
      } else if (action === "zones") closeZones();
      else if (action === "resources") closeResources();
      else if (action === "history") closeHistory();
      else if (action === "extended") onExtendedChange(false);
      event.preventDefault();
      event.stopPropagation();
    },
    [
      api,
      closeHistory,
      closeResources,
      closeZones,
      extended,
      hasOpenDialog,
      historyOpen,
      onExtendedChange,
      resourcesOpen,
      zonesOpen,
    ],
  );

  return {
    zonesOpen,
    resourcesOpen,
    historyOpen,
    closeZones,
    closeResources,
    closeHistory,
    toggleZones,
    toggleResources,
    toggleHistory,
    restoreFocus,
    handleKeyDownCapture,
  };
}
