import { t } from "@lingui/core/macro";
import {
  HiArrowDownTray,
  HiArrowLeft,
  HiArrowsPointingOut,
  HiEllipsisHorizontal,
  HiOutlineClock,
  HiOutlineLink,
  HiOutlineMap,
  HiOutlinePencil,
  HiOutlinePhoto,
  HiOutlineQueueList,
  HiOutlineRectangleGroup,
} from "react-icons/hi2";

import type { CardCanvasExportFormat } from "./card-canvas-export";
import type { CardCanvasSaveState } from "./card-canvas-types";

interface CardCanvasToolbarProps {
  cardTitle?: string;
  saveState: CardCanvasSaveState;
  canEdit: boolean;
  onToggleZones: () => void;
  onToggleResources: () => void;
  onToggleHistory: () => void;
  onAddImage?: () => void;
  imageImportDisabled?: boolean;
  onAddLink?: () => void;
  onTogglePenMode?: () => void;
  onConvert: () => void;
  onExport: (format: CardCanvasExportFormat) => void;
  onExit?: () => void;
  onToggleExtended?: () => void;
  extended?: boolean;
  penModeEnabled?: boolean;
  zonesOpen?: boolean;
  resourcesOpen?: boolean;
  historyOpen?: boolean;
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
  pressed,
  id,
  controls,
  expanded,
  prominent = false,
  disabled = false,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  pressed?: boolean;
  id?: string;
  controls?: string;
  expanded?: boolean;
  prominent?: boolean;
  disabled?: boolean;
}) => (
  <button
    id={id}
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="flex h-11 min-w-11 shrink-0 touch-manipulation items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium text-light-800 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent dark:text-dark-800 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800 dark:disabled:hover:bg-transparent"
    aria-label={label}
    aria-pressed={pressed}
    aria-controls={controls}
    aria-expanded={expanded}
  >
    {icon}
    <span className={prominent ? "hidden sm:inline" : "hidden lg:inline"}>
      {label}
    </span>
  </button>
);

export function CardCanvasToolbar({
  cardTitle,
  saveState,
  canEdit,
  onToggleZones,
  onToggleResources,
  onToggleHistory,
  onAddImage,
  imageImportDisabled = false,
  onAddLink,
  onTogglePenMode,
  onConvert,
  onExport,
  onExit,
  onToggleExtended,
  extended = false,
  penModeEnabled = false,
  zonesOpen = false,
  resourcesOpen = false,
  historyOpen = false,
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
    <div className="relative z-40 flex min-h-12 shrink-0 items-center gap-0.5 border-b border-light-300 bg-light-50 px-1 dark:border-dark-400 dark:bg-dark-100 sm:gap-1 sm:px-3">
      <div className="flex min-w-0 flex-1 items-center gap-0.5 sm:gap-1">
        {onExit && (
          <button
            type="button"
            onClick={onExit}
            className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-md text-light-800 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:text-dark-800 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
            aria-label={t`Leave whiteboard`}
          >
            <HiArrowLeft className="h-4 w-4" />
          </button>
        )}
        {cardTitle && (
          <span className="hidden max-w-[18vw] truncate text-xs font-semibold text-light-1000 dark:text-dark-1000 sm:block">
            {cardTitle}
          </span>
        )}
        {canEdit && onAddImage && (
          <ToolbarButton
            label={t`Image`}
            icon={<HiOutlinePhoto className="h-4 w-4" />}
            onClick={onAddImage}
            disabled={imageImportDisabled}
          />
        )}
        {canEdit && onAddLink && (
          <ToolbarButton
            label={t`Link`}
            icon={<HiOutlineLink className="h-4 w-4" />}
            onClick={onAddLink}
          />
        )}
        {canEdit && onTogglePenMode && (
          <ToolbarButton
            label={penModeEnabled ? t`Disable pen mode` : t`Enable pen mode`}
            icon={<HiOutlinePencil className="h-4 w-4" />}
            onClick={onTogglePenMode}
            pressed={penModeEnabled}
          />
        )}
        <details className="relative shrink-0 md:hidden">
          <summary
            className="flex h-11 min-w-11 cursor-pointer touch-manipulation list-none items-center justify-center rounded-md text-light-800 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:text-dark-800 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
            aria-label={t`More whiteboard actions`}
          >
            <HiEllipsisHorizontal className="h-5 w-5" />
          </summary>
          <div className="absolute left-0 top-12 z-50 w-52 overflow-hidden rounded-md border border-light-400 bg-light-50 py-1 shadow-lg dark:border-dark-500 dark:bg-dark-100">
            <button
              type="button"
              aria-controls="card-canvas-zones-drawer"
              aria-expanded={zonesOpen}
              onClick={(event) => {
                onToggleZones();
                event.currentTarget.closest("details")?.removeAttribute("open");
              }}
              className="flex min-h-11 w-full items-center gap-3 px-3 text-left text-xs text-light-900 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-light-800 dark:text-dark-900 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
            >
              <HiOutlineMap className="h-4 w-4" />
              {t`Zones`}
            </button>
            <button
              type="button"
              aria-controls="card-canvas-resources-drawer"
              aria-expanded={resourcesOpen}
              onClick={(event) => {
                onToggleResources();
                event.currentTarget.closest("details")?.removeAttribute("open");
              }}
              className="flex min-h-11 w-full items-center gap-3 px-3 text-left text-xs text-light-900 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-light-800 dark:text-dark-900 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
            >
              <HiOutlineQueueList className="h-4 w-4" />
              {t`Resources`}
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={(event) => {
                  onConvert();
                  event.currentTarget
                    .closest("details")
                    ?.removeAttribute("open");
                }}
                className="flex min-h-11 w-full items-center gap-3 px-3 text-left text-xs text-light-900 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-light-800 dark:text-dark-900 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
              >
                <HiOutlineRectangleGroup className="h-4 w-4" />
                {t`Convert`}
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                aria-controls="card-canvas-history-drawer"
                aria-expanded={historyOpen}
                onClick={(event) => {
                  onToggleHistory();
                  event.currentTarget
                    .closest("details")
                    ?.removeAttribute("open");
                }}
                className="flex min-h-11 w-full items-center gap-3 px-3 text-left text-xs text-light-900 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-light-800 dark:text-dark-900 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
              >
                <HiOutlineClock className="h-4 w-4" />
                {t`History`}
              </button>
            )}
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
                className="flex min-h-11 w-full items-center gap-3 px-3 text-left text-xs text-light-900 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-light-800 dark:text-dark-900 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
              >
                <HiArrowDownTray className="h-4 w-4" />
                {format === "excalidraw"
                  ? t`Export .excalidraw`
                  : t`Export ${format.toUpperCase()}`}
              </button>
            ))}
          </div>
        </details>
        <div className="hidden items-center gap-1 md:flex">
          <ToolbarButton
            label={t`Zones`}
            icon={<HiOutlineMap className="h-4 w-4" />}
            onClick={onToggleZones}
            id="card-canvas-zones-trigger"
            controls="card-canvas-zones-drawer"
            expanded={zonesOpen}
            pressed={zonesOpen}
          />
          <ToolbarButton
            label={t`Resources`}
            icon={<HiOutlineQueueList className="h-4 w-4" />}
            onClick={onToggleResources}
            id="card-canvas-resources-trigger"
            controls="card-canvas-resources-drawer"
            expanded={resourcesOpen}
            pressed={resourcesOpen}
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
              id="card-canvas-history-trigger"
              controls="card-canvas-history-drawer"
              expanded={historyOpen}
              pressed={historyOpen}
            />
          )}
          <details className="relative shrink-0">
            <summary className="flex h-11 min-w-11 cursor-pointer touch-manipulation list-none items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium text-light-800 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:text-dark-800 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800">
              <HiArrowDownTray className="h-4 w-4" />
              <span className="hidden lg:inline">{t`Export`}</span>
            </summary>
            <div className="absolute left-0 top-11 z-50 min-w-40 overflow-hidden rounded-md border border-light-400 bg-light-50 py-1 shadow-lg dark:border-dark-500 dark:bg-dark-100">
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
                  className="block min-h-11 w-full px-3 text-left text-xs text-light-900 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-light-800 dark:text-dark-900 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
                >
                  {format === "excalidraw"
                    ? ".excalidraw"
                    : format.toUpperCase()}
                </button>
              ))}
            </div>
          </details>
        </div>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
        {onToggleExtended && (
          <ToolbarButton
            label={extended ? t`Back to card` : t`Extend`}
            icon={
              extended ? (
                <HiArrowLeft className="h-4 w-4" />
              ) : (
                <HiArrowsPointingOut className="h-4 w-4" />
              )
            }
            onClick={onToggleExtended}
            pressed={extended}
            prominent
          />
        )}
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
    </div>
  );
}
