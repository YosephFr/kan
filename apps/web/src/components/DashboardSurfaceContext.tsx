import { createContext, useContext } from "react";

export type DashboardSurfaceMode = "default" | "card-whiteboard";

interface DashboardSurfaceContextValue {
  hasRightPanel: boolean;
  isRightPanelOpen: boolean;
  mode: DashboardSurfaceMode;
  setMode: (mode: DashboardSurfaceMode) => void;
  toggleRightPanel: () => void;
}

const DashboardSurfaceContext = createContext<DashboardSurfaceContextValue>({
  hasRightPanel: false,
  isRightPanelOpen: false,
  mode: "default",
  setMode: () => undefined,
  toggleRightPanel: () => undefined,
});

export const DashboardSurfaceProvider = DashboardSurfaceContext.Provider;

export const useDashboardSurface = () => useContext(DashboardSurfaceContext);
