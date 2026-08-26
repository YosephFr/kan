import { t } from "@lingui/core/macro";
import {
  HiArrowDownTray,
  HiArrowLeft,
  HiArrowsPointingOut,
  HiEllipsisHorizontal,
  HiOutlineClipboard,
  HiOutlineClock,
  HiOutlineHome,
  HiOutlinePencil,
  HiOutlinePhoto,
} from "react-icons/hi2";

import type { CardCanvasExportFormat } from "~/views/card/components/card-canvas-export";
import type { CardCanvasSaveState } from "~/views/card/components/card-canvas-types";

interface WorkspaceGoalsToolbarProps {
  workspaceName: string;
  saveState: CardCanvasSaveState;
  canEdit: boolean;
  extended: boolean;
  penModeEnabled: boolean;
  historyOpen: boolean;
  pasteBusy?: boolean;
  onPaste?: () => void;
  onAddImage?: () => void;
  onTogglePenMode?: () => void;
  onHome: () => void;
  onToggleHistory: () => void;
  onExport: (format: CardCanvasExportFormat) => void;
  onToggleExtended: () => void;
  onRetrySave?: () => void;
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

function ToolbarButton({
  label,
  icon,
  onClick,
  pressed,
  disabled,
  busy,
  prominent = false,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  busy?: boolean;
  prominent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      aria-busy={busy ?? undefined}
      className="flex h-11 min-w-11 shrink-0 touch-manipulation items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium text-light-800 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 disabled:cursor-not-allowed disabled:opacity-50 dark:text-dark-800 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
    >
      <span className={busy ? "animate-pulse" : undefined}>{icon}</span>
      <span className={prominent ? "hidden sm:inline" : "hidden xl:inline"}>
        {label}
      </span>
    </button>
  );
}

function ExportOptions({
  onExport,
}: {
  onExport: (format: CardCanvasExportFormat) => void;
}) {
  return (["png", "svg", "excalidraw"] as const).map((format) => (
    <button
      key={format}
      type="button"
      onClick={(event) => {
        onExport(format);
        const details = event.currentTarget.closest("details");
        const summary = details?.querySelector<HTMLElement>("summary");
        details?.removeAttribute("open");
        requestAnimationFrame(() => summary?.focus());
      }}
      className="block min-h-11 w-full px-3 text-left text-xs text-light-900 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-light-800 dark:text-dark-900 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
    >
      {format === "excalidraw" ? ".excalidraw" : format.toUpperCase()}
    </button>
  ));
}

export function WorkspaceGoalsToolbar({
  workspaceName,
  saveState,
  canEdit,
  extended,
  penModeEnabled,
  historyOpen,
  pasteBusy = false,
  onPaste,
  onAddImage,
  onTogglePenMode,
  onHome,
  onToggleHistory,
  onExport,
  onToggleExtended,
  onRetrySave,
}: WorkspaceGoalsToolbarProps) {
  const statusTone =
    saveState === "conflict" || saveState === "invalid" || saveState === "error"
      ? "bg-red-500"
      : saveState === "offline" || saveState === "local"
        ? "bg-amber-500"
        : saveState === "saving" || saveState === "loading"
          ? "animate-pulse bg-blue-500"
          : "bg-emerald-500";

  return (
    <div
      className="relative z-40 flex min-h-12 shrink-0 items-center gap-0.5 border-b border-light-300 bg-light-50 px-1 dark:border-dark-400 dark:bg-dark-100 sm:gap-1 sm:px-3"
      style={{ containerType: "inline-size" }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-0.5 sm:gap-1">
        {extended && (
          <span className="hidden max-w-[22vw] truncate text-xs font-semibold text-light-1000 dark:text-dark-1000 sm:block">
            {t`Vision and goals for ${workspaceName}`}
          </span>
        )}
        {canEdit && onPaste && (
          <ToolbarButton
            label={t`Paste`}
            icon={<HiOutlineClipboard className="h-4 w-4" />}
            onClick={onPaste}
            disabled={pasteBusy}
            busy={pasteBusy}
            prominent
          />
        )}
        {canEdit && onAddImage && (
          <div className="hidden min-[480px]:block">
            <ToolbarButton
              label={t`Image`}
              icon={<HiOutlinePhoto className="h-4 w-4" />}
              onClick={onAddImage}
              disabled={pasteBusy}
            />
          </div>
        )}
        {canEdit && onTogglePenMode && (
          <div className="hidden min-[480px]:block">
            <ToolbarButton
              label={penModeEnabled ? t`Disable pen mode` : t`Enable pen mode`}
              icon={<HiOutlinePencil className="h-4 w-4" />}
              onClick={onTogglePenMode}
              pressed={penModeEnabled}
            />
          </div>
        )}
        <ToolbarButton
          label={t`Back to the beginning`}
          icon={<HiOutlineHome className="h-4 w-4" />}
          onClick={onHome}
        />
        <details className="relative hidden shrink-0 min-[480px]:block">
          <summary
            className="flex h-11 min-w-11 cursor-pointer touch-manipulation list-none items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium text-light-800 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:text-dark-800 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
            aria-label={t`Export`}
          >
            <HiArrowDownTray className="h-4 w-4" />
            <span className="hidden xl:inline">{t`Export`}</span>
          </summary>
          <div className="absolute left-0 top-11 z-50 min-w-44 overflow-hidden rounded-md border border-light-400 bg-light-50 py-1 shadow-lg dark:border-dark-500 dark:bg-dark-100">
            <ExportOptions onExport={onExport} />
          </div>
        </details>
        {canEdit && (
          <div className="hidden min-[480px]:block">
            <ToolbarButton
              label={t`History`}
              icon={<HiOutlineClock className="h-4 w-4" />}
              onClick={onToggleHistory}
              pressed={historyOpen}
            />
          </div>
        )}
        <details className="relative shrink-0 min-[480px]:hidden">
          <summary
            className="flex h-11 min-w-11 cursor-pointer touch-manipulation list-none items-center justify-center rounded-md text-light-800 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:text-dark-800 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
            aria-label={t`More whiteboard actions`}
          >
            <HiEllipsisHorizontal className="h-5 w-5" />
          </summary>
          <div className="absolute left-0 top-11 z-50 min-w-48 overflow-hidden rounded-md border border-light-400 bg-light-50 py-1 shadow-lg dark:border-dark-500 dark:bg-dark-100">
            {canEdit && onAddImage && (
              <button
                type="button"
                disabled={pasteBusy}
                onClick={(event) => {
                  onAddImage();
                  const details = event.currentTarget.closest("details");
                  const summary =
                    details?.querySelector<HTMLElement>("summary");
                  details?.removeAttribute("open");
                  requestAnimationFrame(() => summary?.focus());
                }}
                className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-xs text-light-900 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-light-800 disabled:cursor-not-allowed disabled:opacity-50 dark:text-dark-900 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
              >
                <HiOutlinePhoto className="h-4 w-4" />
                {t`Image`}
              </button>
            )}
            {canEdit && onTogglePenMode && (
              <button
                type="button"
                onClick={(event) => {
                  onTogglePenMode();
                  const details = event.currentTarget.closest("details");
                  const summary =
                    details?.querySelector<HTMLElement>("summary");
                  details?.removeAttribute("open");
                  requestAnimationFrame(() => summary?.focus());
                }}
                aria-pressed={penModeEnabled}
                className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-xs text-light-900 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-light-800 dark:text-dark-900 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
              >
                <HiOutlinePencil className="h-4 w-4" />
                {penModeEnabled ? t`Disable pen mode` : t`Enable pen mode`}
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={(event) => {
                  onToggleHistory();
                  const details = event.currentTarget.closest("details");
                  const summary =
                    details?.querySelector<HTMLElement>("summary");
                  details?.removeAttribute("open");
                  requestAnimationFrame(() => summary?.focus());
                }}
                aria-pressed={historyOpen}
                className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-xs text-light-900 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-light-800 dark:text-dark-900 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
              >
                <HiOutlineClock className="h-4 w-4" />
                {t`History`}
              </button>
            )}
            <div className="border-t border-light-300 dark:border-dark-400">
              <ExportOptions onExport={onExport} />
            </div>
          </div>
        </details>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
        <ToolbarButton
          label={extended ? t`Back to boards` : t`Extend`}
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
        {saveState === "error" && onRetrySave ? (
          <button
            type="button"
            onClick={onRetrySave}
            aria-label={t`Try saving again`}
            className="flex min-h-11 shrink-0 touch-manipulation items-center gap-1.5 rounded-md px-2 text-[10px] text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 dark:text-red-300 dark:hover:bg-red-950/40"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${statusTone}`} />
            <span className="hidden min-[360px]:inline">{t`Try again`}</span>
          </button>
        ) : (
          <div
            role="status"
            aria-label={saveLabel(saveState)}
            className="flex shrink-0 items-center gap-1.5 text-[10px] text-light-700 dark:text-dark-700"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${statusTone}`} />
            <span className="hidden min-[360px]:inline">
              {saveLabel(saveState)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
