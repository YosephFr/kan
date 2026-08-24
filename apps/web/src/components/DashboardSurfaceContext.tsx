import { createContext, useContext } from "react";

export type DashboardSurfaceMode = "default" | "card-whiteboard";

interface DashboardSurfaceContextValue {
  mode: DashboardSurfaceMode;
  setMode: (mode: DashboardSurfaceMode) => void;
}

const DashboardSurfaceContext = createContext<DashboardSurfaceContextValue>({
  mode: "default",
  setMode: () => undefined,
});

export const DashboardSurfaceProvider = DashboardSurfaceContext.Provider;

export const useDashboardSurface = () => useContext(DashboardSurfaceContext);
