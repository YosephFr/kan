import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { RefObject } from "react";
import { useEffect, useRef } from "react";

export function useCardCanvasViewport({
  api,
  sectionRef,
  enabled,
  layoutKey,
  scrollContainerRef,
}: {
  api: ExcalidrawImperativeAPI | null;
  sectionRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  layoutKey: boolean;
  scrollContainerRef?: RefObject<HTMLElement | null>;
}) {
  const resizeFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || !api) return;

    const refreshCanvas = () => {
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        api.refresh();
      });
    };
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(refreshCanvas);
    if (sectionRef.current) observer?.observe(sectionRef.current);
    const viewport = window.visualViewport;
    const scrollContainer = scrollContainerRef?.current;
    viewport?.addEventListener("resize", refreshCanvas);
    viewport?.addEventListener("scroll", refreshCanvas);
    scrollContainer?.addEventListener("scroll", refreshCanvas, {
      passive: true,
    });
    window.addEventListener("orientationchange", refreshCanvas);
    refreshCanvas();
    const transitionTimer = window.setTimeout(refreshCanvas, 340);

    return () => {
      observer?.disconnect();
      viewport?.removeEventListener("resize", refreshCanvas);
      viewport?.removeEventListener("scroll", refreshCanvas);
      scrollContainer?.removeEventListener("scroll", refreshCanvas);
      window.removeEventListener("orientationchange", refreshCanvas);
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
      window.clearTimeout(transitionTimer);
    };
  }, [api, enabled, layoutKey, scrollContainerRef, sectionRef]);
}
