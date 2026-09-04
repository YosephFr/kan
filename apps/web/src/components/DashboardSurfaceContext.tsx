import type { RefObject } from "react";
import { createContext, useContext } from "react";

interface DashboardSurfaceContextValue {
  hasRightPanel: boolean;
  isRightPanelOpen: boolean;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  toggleRightPanel: () => void;
}

const DashboardSurfaceContext = createContext<DashboardSurfaceContextValue>({
  hasRightPanel: false,
  isRightPanelOpen: false,
  scrollContainerRef: { current: null },
  toggleRightPanel: () => undefined,
});

export const DashboardSurfaceProvider = DashboardSurfaceContext.Provider;

export const useDashboardSurface = () => useContext(DashboardSurfaceContext);
