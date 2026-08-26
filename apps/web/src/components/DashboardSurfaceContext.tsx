import type { RefObject } from "react";
import { createContext, useContext } from "react";

export type DashboardSurfaceMode =
  | "default"
  | "card-whiteboard"
  | "workspace-whiteboard";

interface DashboardSurfaceContextValue {
  hasRightPanel: boolean;
  isRightPanelOpen: boolean;
  mode: DashboardSurfaceMode;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  setMode: (mode: DashboardSurfaceMode) => void;
  toggleRightPanel: () => void;
}

const DashboardSurfaceContext = createContext<DashboardSurfaceContextValue>({
  hasRightPanel: false,
  isRightPanelOpen: false,
  mode: "default",
  scrollContainerRef: { current: null },
  setMode: () => undefined,
  toggleRightPanel: () => undefined,
});

export const DashboardSurfaceProvider = DashboardSurfaceContext.Provider;

export const useDashboardSurface = () => useContext(DashboardSurfaceContext);
