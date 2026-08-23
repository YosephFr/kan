import { t } from "@lingui/core/macro";
import { useMemo, useState } from "react";
import { HiMagnifyingGlass, HiOutlineMap, HiXMark } from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

import type { CardCanvasFrameView } from "./card-canvas-types";

const getStageLabel = (
  status: CardCanvasFrameView["subtask"] extends null
    ? never
    : NonNullable<CardCanvasFrameView["subtask"]>["stageStatus"],
) => {
  if (status === "inProgress") return t`In progress`;
  if (status === "blocked") return t`Blocked`;
  if (status === "done") return t`Done`;
  return t`Planned`;
};

interface CardCanvasZonesDrawerProps {
  open: boolean;
  frames: CardCanvasFrameView[];
  activeFramePublicId: string | null;
  isLoading: boolean;
  onClose: () => void;
  onFocusFrame: (framePublicId: string) => void;
}

export function CardCanvasZonesDrawer({
  open,
  frames,
  activeFramePublicId,
  isLoading,
  onClose,
  onFocusFrame,
}: CardCanvasZonesDrawerProps) {
  const [query, setQuery] = useState("");
  const visibleFrames = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return frames;
    return frames.filter(
      (frame) =>
        frame.name.toLocaleLowerCase().includes(normalizedQuery) ||
        frame.subtask?.title.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [frames, query]);

  return (
    <aside
      aria-label={t`Whiteboard zones`}
      aria-hidden={!open}
      className={twMerge(
        "absolute inset-y-0 left-0 z-30 flex w-[min(21rem,calc(100vw-1rem))] flex-col border-r border-light-300 bg-light-50 shadow-xl transition-transform duration-300 dark:border-dark-400 dark:bg-dark-100",
        open ? "translate-x-0" : "-translate-x-full",
      )}
    >
      <div className="flex h-12 items-center justify-between border-b border-light-300 px-4 dark:border-dark-400">
        <div className="flex items-center gap-2">
          <HiOutlineMap className="h-4 w-4 text-light-700 dark:text-dark-700" />
          <h2 className="text-sm font-semibold text-light-1000 dark:text-dark-1000">
            {t`Zones`}
          </h2>
          {frames.length > 0 && (
            <span className="text-xs tabular-nums text-light-700 dark:text-dark-700">
              {frames.length}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-md text-light-700 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:text-dark-700 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
          aria-label={t`Close zones`}
        >
          <HiXMark className="h-5 w-5" />
        </button>
      </div>
      <label className="relative mx-3 mt-3 block">
        <HiMagnifyingGlass className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-light-600 dark:text-dark-600" />
        <span className="sr-only">{t`Search zones`}</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t`Search zones…`}
          className="h-9 w-full rounded-md border border-light-400 bg-light-50 pl-8 pr-3 text-xs text-light-1000 placeholder:text-light-600 focus:border-light-800 focus:ring-light-800 dark:border-dark-500 dark:bg-dark-200 dark:text-dark-1000 dark:placeholder:text-dark-600 dark:focus:border-dark-800 dark:focus:ring-dark-800"
        />
      </label>
      <div className="mt-3 flex-1 overflow-y-auto border-t border-light-300 dark:border-dark-400">
        {isLoading ? (
          <div className="space-y-1 p-3" role="status">
            {[0, 1, 2].map((item) => (
              <div
                key={item}
                className="h-16 animate-pulse bg-light-200 dark:bg-dark-200"
              />
            ))}
          </div>
        ) : visibleFrames.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm font-medium text-light-900 dark:text-dark-900">
              {query ? t`No matching zones` : t`No zones yet`}
            </p>
            {!query && (
              <p className="mt-1 text-xs leading-5 text-light-700 dark:text-dark-700">
                {t`Use the frame tool to organise the whiteboard.`}
              </p>
            )}
          </div>
        ) : (
          <ol className="divide-y divide-light-300 dark:divide-dark-400">
            {visibleFrames.map((frame) => (
              <li key={frame.publicId}>
                <button
                  type="button"
                  onClick={() => onFocusFrame(frame.publicId)}
                  className={twMerge(
                    "w-full px-4 py-3 text-left hover:bg-light-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-light-800 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800",
                    activeFramePublicId === frame.publicId &&
                      "bg-light-200 dark:bg-dark-200",
                  )}
                >
                  <span className="block truncate text-sm font-medium text-light-1000 dark:text-dark-1000">
                    {frame.name}
                  </span>
                  {frame.subtask ? (
                    <span className="mt-1.5 block">
                      <span className="flex items-center justify-between gap-2 text-[10px] text-light-700 dark:text-dark-700">
                        <span className="truncate">
                          {getStageLabel(frame.subtask.stageStatus)} ·{" "}
                          {frame.subtask.title}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {frame.subtask.checklist.completed}/
                          {frame.subtask.checklist.total}
                        </span>
                      </span>
                      <span className="mt-1 block h-1 overflow-hidden rounded-full bg-light-300 dark:bg-dark-400">
                        <span
                          className="block h-full bg-blue-600 transition-[width] duration-500"
                          style={{
                            width: `${frame.subtask.checklist.progressPercent}%`,
                          }}
                        />
                      </span>
                    </span>
                  ) : (
                    <span className="mt-1 block text-[10px] text-light-600 dark:text-dark-600">
                      {t`Not converted to a subtask`}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}
