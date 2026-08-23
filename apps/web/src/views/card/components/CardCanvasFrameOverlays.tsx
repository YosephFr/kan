import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { sceneCoordsToViewportCoords } from "@excalidraw/excalidraw";
import { t } from "@lingui/core/macro";
import { useEffect, useState } from "react";

import type { CardCanvasFrameView } from "./card-canvas-types";

interface CardCanvasFrameOverlaysProps {
  api: ExcalidrawImperativeAPI | null;
  container: HTMLElement | null;
  frames: CardCanvasFrameView[];
  onOpenSubtask: (subtaskPublicId: string) => void;
}

const stageLabel = (
  status: NonNullable<CardCanvasFrameView["subtask"]>["stageStatus"],
) => {
  if (status === "inProgress") return t`In progress`;
  if (status === "blocked") return t`Blocked`;
  if (status === "done") return t`Done`;
  return t`Planned`;
};

export function CardCanvasFrameOverlays({
  api,
  container,
  frames,
  onOpenSubtask,
}: CardCanvasFrameOverlaysProps) {
  const [, setRevision] = useState(0);

  useEffect(() => {
    if (!api) return;
    let animationFrame: number | null = null;
    const unsubscribe = api.onChange(() => {
      if (animationFrame !== null) return;
      animationFrame = requestAnimationFrame(() => {
        animationFrame = null;
        setRevision((current) => current + 1);
      });
    });
    const resizeObserver = new ResizeObserver(() =>
      setRevision((current) => current + 1),
    );
    if (container) resizeObserver.observe(container);
    return () => {
      unsubscribe();
      resizeObserver.disconnect();
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    };
  }, [api, container]);

  const overlays = (() => {
    if (!api || !container) return [];
    const appState = api.getAppState();
    const containerRect = container.getBoundingClientRect();
    const elementsById = new Map(
      api.getSceneElements().map((element) => [element.id, element]),
    );
    return frames.flatMap((frame) => {
      if (!frame.subtask) return [];
      const element = elementsById.get(frame.elementId);
      if (!element || element.isDeleted || element.type !== "frame") return [];
      const viewport = sceneCoordsToViewportCoords(
        { sceneX: element.x + 12, sceneY: element.y + 12 },
        appState,
      );
      const width = Math.max(
        164,
        Math.min(element.width * appState.zoom.value - 24, 300),
      );
      return [
        {
          frame,
          x: viewport.x - containerRect.left,
          y: viewport.y - containerRect.top,
          width,
          compact: appState.zoom.value < 0.45,
        },
      ];
    });
  })();

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {overlays.map(({ frame, x, y, width, compact }) => {
        const subtask = frame.subtask;
        if (!subtask) return null;
        return (
          <button
            key={frame.publicId}
            type="button"
            onClick={() => onOpenSubtask(subtask.publicId)}
            className="pointer-events-auto absolute overflow-hidden rounded-md border border-light-400 bg-light-50/95 text-left shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-dark-500 dark:bg-dark-100/95"
            style={{
              left: x,
              top: y,
              width,
              transformOrigin: "top left",
            }}
            title={t`Open subtask`}
          >
            {compact ? (
              <span className="block truncate px-2 py-1 text-[10px] font-medium text-light-1000 dark:text-dark-1000">
                {subtask.title}
              </span>
            ) : (
              <span className="block px-3 py-2.5">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-light-1000 dark:text-dark-1000">
                    {subtask.title}
                  </span>
                  <span className="shrink-0 text-[9px] text-light-600 dark:text-dark-600">
                    {stageLabel(subtask.stageStatus)}
                  </span>
                </span>
                <span className="mt-2 flex items-center gap-2">
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-light-300 dark:bg-dark-400">
                    <span
                      className="block h-full bg-blue-600"
                      style={{
                        width: `${subtask.checklist.progressPercent}%`,
                      }}
                    />
                  </span>
                  <span className="text-[9px] tabular-nums text-light-600 dark:text-dark-600">
                    {subtask.checklist.completed}/{subtask.checklist.total}
                  </span>
                </span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
