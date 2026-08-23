import { t } from "@lingui/core/macro";
import { HiArrowPath, HiOutlineClock, HiXMark } from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

import type { CardCanvasRevisionView } from "./card-canvas-types";
import { formatResourceSize } from "./resource-upload-queue";

interface CardCanvasHistoryDrawerProps {
  open: boolean;
  revisions: CardCanvasRevisionView[];
  isLoading: boolean;
  isRestoring: boolean;
  disabled: boolean;
  onClose: () => void;
  onRestore: (revisionPublicId: string) => void;
}

export function CardCanvasHistoryDrawer({
  open,
  revisions,
  isLoading,
  isRestoring,
  disabled,
  onClose,
  onRestore,
}: CardCanvasHistoryDrawerProps) {
  return (
    <aside
      aria-label={t`Whiteboard history`}
      aria-hidden={!open}
      className={twMerge(
        "absolute inset-y-0 right-0 z-30 flex w-[min(23rem,calc(100vw-1rem))] flex-col border-l border-light-300 bg-light-50 shadow-xl transition-transform duration-300 dark:border-dark-400 dark:bg-dark-100",
        open ? "translate-x-0" : "translate-x-full",
      )}
    >
      <div className="flex h-12 items-center justify-between border-b border-light-300 px-4 dark:border-dark-400">
        <div className="flex items-center gap-2">
          <HiOutlineClock className="h-4 w-4 text-light-700 dark:text-dark-700" />
          <h2 className="text-sm font-semibold text-light-1000 dark:text-dark-1000">
            {t`History`}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-md text-light-700 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:text-dark-700 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
          aria-label={t`Close history`}
        >
          <HiXMark className="h-5 w-5" />
        </button>
      </div>
      {disabled && (
        <div className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          {t`Finish saving or resolve the conflict before restoring a revision.`}
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-1 p-3" role="status">
            {[0, 1, 2].map((item) => (
              <div
                key={item}
                className="h-16 animate-pulse bg-light-200 dark:bg-dark-200"
              />
            ))}
          </div>
        ) : revisions.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm font-medium text-light-900 dark:text-dark-900">
              {t`No checkpoints yet`}
            </p>
            <p className="mt-1 text-xs leading-5 text-light-700 dark:text-dark-700">
              {t`A checkpoint is created automatically as the whiteboard changes.`}
            </p>
          </div>
        ) : (
          <ol className="divide-y divide-light-300 dark:divide-dark-400">
            {revisions.map((revision) => (
              <li
                key={revision.publicId}
                className="flex items-center gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-light-1000 dark:text-dark-1000">
                    {revision.kind === "preRestore"
                      ? t`Before restoration`
                      : t`Automatic checkpoint`}
                  </p>
                  <p className="mt-1 text-[10px] text-light-600 dark:text-dark-600">
                    {new Intl.DateTimeFormat(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(revision.createdAt))}
                    {" · "}
                    {revision.elementCount} {t`elements`}
                    {" · "}
                    {formatResourceSize(revision.bytes)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onRestore(revision.publicId)}
                  disabled={disabled || isRestoring}
                  className="flex h-8 items-center gap-1.5 rounded-md border border-light-400 px-2 text-[11px] font-medium text-light-900 hover:bg-light-200 disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-500 dark:text-dark-900 dark:hover:bg-dark-200"
                >
                  <HiArrowPath className="h-3.5 w-3.5" />
                  {t`Restore`}
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}
