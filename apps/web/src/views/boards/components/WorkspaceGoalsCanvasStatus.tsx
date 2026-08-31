import { t } from "@lingui/core/macro";
import { HiArrowPath, HiOutlineExclamationTriangle } from "react-icons/hi2";

export interface WorkspaceGoalsCanvasProps {
  workspacePublicId: string;
  workspaceName: string;
  canEdit: boolean;
}

export function WorkspaceGoalsCanvasThemeStyle({ dark }: { dark: boolean }) {
  return (
    <style jsx global>{`
      .kan-workspace-canvas [data-testid="toolbar-frame"],
      .kan-workspace-canvas [data-testid="toolbar-embeddable"],
      .kan-workspace-canvas [data-testid="toolbar-magicframe"] {
        display: none !important;
      }
      .kan-workspace-canvas .excalidraw,
      .kan-workspace-canvas .excalidraw .App-menu_top {
        --color-primary: ${dark ? "#f0f0f0" : "#202020"};
      }
    `}</style>
  );
}

export function WorkspaceGoalsCanvasLoadState({
  error,
  onRetry,
}: {
  error: boolean;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <div className="flex h-[70dvh] min-h-[28rem] items-center justify-center bg-light-100 p-6 text-center dark:bg-dark-50">
        <div>
          <HiOutlineExclamationTriangle className="mx-auto h-7 w-7 text-red-600 dark:text-red-400" />
          <p className="mt-3 text-sm font-medium text-light-1000 dark:text-dark-1000">
            {t`Workspace whiteboard could not be loaded`}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md border border-light-500 px-3 py-2 text-xs font-medium text-light-900 hover:bg-light-200 dark:border-dark-500 dark:text-dark-900 dark:hover:bg-dark-200"
          >
            <HiArrowPath className="h-4 w-4" />
            {t`Try again`}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-[70dvh] min-h-[28rem] items-center justify-center bg-light-100 dark:bg-dark-50"
      role="status"
    >
      <div className="flex items-center gap-2 text-sm text-light-700 dark:text-dark-700">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-light-400 border-t-light-900 dark:border-dark-400 dark:border-t-dark-900" />
        {t`Opening workspace whiteboard…`}
      </div>
    </div>
  );
}

interface WorkspaceGoalsCanvasStatusProps {
  validationError: boolean;
  imagesLoading: boolean;
  imagesLoaded: number;
  imagesTotal: number;
  imageLoadError: boolean;
  failedImageCount: number;
  pasteBusy: boolean;
  online: boolean;
  onRetryImages: () => void;
  onRetryFailedPaste: () => void;
}

export function WorkspaceGoalsCanvasStatus({
  validationError,
  imagesLoading,
  imagesLoaded,
  imagesTotal,
  imageLoadError,
  failedImageCount,
  pasteBusy,
  online,
  onRetryImages,
  onRetryFailedPaste,
}: WorkspaceGoalsCanvasStatusProps) {
  if (
    !validationError &&
    !imagesLoading &&
    !imageLoadError &&
    failedImageCount === 0
  ) {
    return null;
  }

  return (
    <div className="absolute bottom-3 left-1/2 z-30 flex w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-col gap-2">
      {validationError && (
        <div
          className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 shadow-sm dark:border-red-900 dark:bg-red-950/60 dark:text-red-300"
          role="alert"
        >
          {t`This scene contains unsupported or unsafe content and cannot be saved.`}
        </div>
      )}
      {imagesLoading && (
        <div
          className="rounded-md border border-light-400 bg-light-50 px-3 py-2 text-xs text-light-800 shadow-sm dark:border-dark-500 dark:bg-dark-100 dark:text-dark-800"
          role="status"
        >
          {t`Loading whiteboard images (${Number(imagesLoaded)} of ${Number(imagesTotal)})…`}
        </div>
      )}
      {imageLoadError && (
        <div
          className="flex items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow-sm dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
          role="alert"
        >
          <span>{t`Some whiteboard images could not be loaded.`}</span>
          <button
            type="button"
            onClick={onRetryImages}
            className="min-h-11 shrink-0 rounded-md border border-amber-400 px-3 font-medium hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 dark:border-amber-800 dark:hover:bg-amber-900/50"
          >
            {t`Try again`}
          </button>
        </div>
      )}
      {failedImageCount > 0 && (
        <div
          className="flex items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow-sm dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
          role="alert"
        >
          <span>{t`${Number(failedImageCount)} images could not be added.`}</span>
          <button
            type="button"
            disabled={pasteBusy || !online}
            onClick={onRetryFailedPaste}
            className="min-h-11 shrink-0 rounded-md border border-amber-400 px-3 font-medium hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-800 dark:hover:bg-amber-900/50"
          >
            {t`Try failed images again`}
          </button>
        </div>
      )}
    </div>
  );
}
