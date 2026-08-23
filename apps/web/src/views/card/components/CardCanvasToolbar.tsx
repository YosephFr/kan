import { t } from "@lingui/core/macro";
import {
  HiArrowDownTray,
  HiArrowLeft,
  HiOutlineClock,
  HiOutlineMap,
  HiOutlineQueueList,
  HiOutlineRectangleGroup,
} from "react-icons/hi2";

import type { CardCanvasExportFormat } from "./card-canvas-export";
import type { CardCanvasSaveState } from "./card-canvas-types";

interface CardCanvasToolbarProps {
  cardTitle: string;
  saveState: CardCanvasSaveState;
  canEdit: boolean;
  onToggleZones: () => void;
  onToggleResources: () => void;
  onToggleHistory: () => void;
  onConvert: () => void;
  onExport: (format: CardCanvasExportFormat) => void;
  onExit: () => void;
}

const saveLabel = (state: CardCanvasSaveState) => {
  if (state === "loading") return t`Loading…`;
  if (state === "saving") return t`Saving…`;
  if (state === "local") return t`Saved locally`;
  if (state === "offline") return t`Offline · saved locally`;
  if (state === "conflict") return t`Conflict`;
  if (state === "invalid") return t`Cannot save`;
  if (state === "error") return t`Save failed`;
  return t`Saved`;
};

const ToolbarButton = ({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className="flex h-8 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium text-light-800 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:text-dark-800 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
    aria-label={label}
  >
    {icon}
    <span className="hidden lg:inline">{label}</span>
  </button>
);

export function CardCanvasToolbar({
  cardTitle,
  saveState,
  canEdit,
  onToggleZones,
  onToggleResources,
  onToggleHistory,
  onConvert,
  onExport,
  onExit,
}: CardCanvasToolbarProps) {
  const statusTone =
    saveState === "conflict" || saveState === "invalid" || saveState === "error"
      ? "bg-red-500"
      : saveState === "offline" || saveState === "local"
        ? "bg-amber-500"
        : saveState === "saving" || saveState === "loading"
          ? "animate-pulse bg-blue-500"
          : "bg-emerald-500";

  return (
    <div className="relative z-40 flex h-11 shrink-0 items-center justify-between gap-2 border-b border-light-300 bg-light-50 px-2 dark:border-dark-400 dark:bg-dark-100 sm:px-3">
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          onClick={onExit}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-light-800 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:text-dark-800 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
          aria-label={t`Leave whiteboard`}
        >
          <HiArrowLeft className="h-4 w-4" />
        </button>
        <span className="hidden max-w-52 truncate text-xs font-semibold text-light-1000 dark:text-dark-1000 xl:block">
          {cardTitle}
        </span>
        <ToolbarButton
          label={t`Zones`}
          icon={<HiOutlineMap className="h-4 w-4" />}
          onClick={onToggleZones}
        />
        <ToolbarButton
          label={t`Resources`}
          icon={<HiOutlineQueueList className="h-4 w-4" />}
          onClick={onToggleResources}
        />
        {canEdit && (
          <ToolbarButton
            label={t`Convert`}
            icon={<HiOutlineRectangleGroup className="h-4 w-4" />}
            onClick={onConvert}
          />
        )}
        {canEdit && (
          <ToolbarButton
            label={t`History`}
            icon={<HiOutlineClock className="h-4 w-4" />}
            onClick={onToggleHistory}
          />
        )}
        <details className="relative">
          <summary className="flex h-8 cursor-pointer list-none items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium text-light-800 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:text-dark-800 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800">
            <HiArrowDownTray className="h-4 w-4" />
            <span className="hidden lg:inline">{t`Export`}</span>
          </summary>
          <div className="absolute left-0 top-9 z-50 min-w-40 overflow-hidden rounded-md border border-light-400 bg-light-50 py-1 shadow-lg dark:border-dark-500 dark:bg-dark-100">
            {(["png", "svg", "excalidraw"] as const).map((format) => (
              <button
                key={format}
                type="button"
                onClick={(event) => {
                  onExport(format);
                  event.currentTarget
                    .closest("details")
                    ?.removeAttribute("open");
                }}
                className="block w-full px-3 py-2 text-left text-xs text-light-900 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-light-800 dark:text-dark-900 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
              >
                {format === "excalidraw" ? ".excalidraw" : format.toUpperCase()}
              </button>
            ))}
          </div>
        </details>
      </div>
      <div
        role="status"
        className="flex shrink-0 items-center gap-1.5 text-[10px] text-light-700 dark:text-dark-700"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${statusTone}`} />
        <span className="hidden min-[360px]:inline">
          {saveLabel(saveState)}
        </span>
      </div>
    </div>
  );
}
