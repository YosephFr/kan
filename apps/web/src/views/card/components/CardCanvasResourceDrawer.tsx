import { t } from "@lingui/core/macro";
import { useMemo, useState } from "react";
import {
  HiArrowTopRightOnSquare,
  HiMagnifyingGlass,
  HiOutlineDocumentText,
  HiOutlineLink,
  HiOutlinePhoto,
  HiOutlineQueueList,
  HiPlusSmall,
  HiXMark,
} from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

import type { CardResource } from "./card-resource-types";

interface CardCanvasResourceDrawerProps {
  open: boolean;
  resources: CardResource[];
  canEdit: boolean;
  isLoading: boolean;
  onClose: () => void;
  onInsert: (resource: CardResource) => void;
  onOpenResource: (resourcePublicId: string) => void;
}

const ResourceIcon = ({ resource }: { resource: CardResource }) => {
  if (resource.kind === "drive") {
    return <HiOutlineLink className="h-5 w-5" />;
  }
  if (resource.contentType.startsWith("image/")) {
    return <HiOutlinePhoto className="h-5 w-5" />;
  }
  return <HiOutlineDocumentText className="h-5 w-5" />;
};

export function CardCanvasResourceDrawer({
  open,
  resources,
  canEdit,
  isLoading,
  onClose,
  onInsert,
  onOpenResource,
}: CardCanvasResourceDrawerProps) {
  const [query, setQuery] = useState("");
  const visibleResources = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return normalizedQuery
      ? resources.filter((resource) =>
          resource.title.toLocaleLowerCase().includes(normalizedQuery),
        )
      : resources;
  }, [query, resources]);

  return (
    <aside
      aria-label={t`Card resources`}
      aria-hidden={!open}
      className={twMerge(
        "absolute inset-y-0 right-0 z-30 flex w-[min(23rem,calc(100vw-1rem))] flex-col border-l border-light-300 bg-light-50 shadow-xl transition-transform duration-300 dark:border-dark-400 dark:bg-dark-100",
        open ? "translate-x-0" : "translate-x-full",
      )}
    >
      <div className="flex h-12 items-center justify-between border-b border-light-300 px-4 dark:border-dark-400">
        <div className="flex items-center gap-2">
          <HiOutlineQueueList className="h-4 w-4 text-light-700 dark:text-dark-700" />
          <h2 className="text-sm font-semibold text-light-1000 dark:text-dark-1000">
            {t`Resources`}
          </h2>
          {resources.length > 0 && (
            <span className="text-xs tabular-nums text-light-700 dark:text-dark-700">
              {resources.length}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-md text-light-700 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:text-dark-700 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
          aria-label={t`Close resources`}
        >
          <HiXMark className="h-5 w-5" />
        </button>
      </div>
      <label className="relative mx-3 mt-3 block">
        <HiMagnifyingGlass className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-light-600 dark:text-dark-600" />
        <span className="sr-only">{t`Search resources`}</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t`Search resources…`}
          className="h-9 w-full rounded-md border border-light-400 bg-light-50 pl-8 pr-3 text-xs text-light-1000 placeholder:text-light-600 focus:border-light-800 focus:ring-light-800 dark:border-dark-500 dark:bg-dark-200 dark:text-dark-1000 dark:placeholder:text-dark-600 dark:focus:border-dark-800 dark:focus:ring-dark-800"
        />
      </label>
      <div className="mt-3 flex-1 overflow-y-auto border-t border-light-300 dark:border-dark-400">
        {isLoading ? (
          <div className="space-y-1 p-3" role="status">
            {[0, 1, 2].map((item) => (
              <div
                key={item}
                className="h-14 animate-pulse bg-light-200 dark:bg-dark-200"
              />
            ))}
          </div>
        ) : visibleResources.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm font-medium text-light-900 dark:text-dark-900">
              {query ? t`No matching resources` : t`No resources yet`}
            </p>
            <p className="mt-1 text-xs leading-5 text-light-700 dark:text-dark-700">
              {t`Add files from the Files view, then return here.`}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-light-300 dark:divide-dark-400">
            {visibleResources.map((resource) => (
              <li
                key={resource.publicId}
                className="flex min-w-0 items-center gap-3 px-4 py-3"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-light-200 text-light-700 dark:bg-dark-200 dark:text-dark-700">
                  <ResourceIcon resource={resource} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-light-1000 dark:text-dark-1000">
                    {resource.title}
                  </p>
                  <p className="mt-0.5 text-[10px] text-light-600 dark:text-dark-600">
                    {resource.kind === "drive" ? t`Google Drive` : t`Upload`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onOpenResource(resource.publicId)}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-light-700 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:text-dark-700 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
                    aria-label={t`Open ${resource.title}`}
                  >
                    <HiArrowTopRightOnSquare className="h-4 w-4" />
                  </button>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => onInsert(resource)}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-light-900 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:text-dark-900 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
                      aria-label={t`Add ${resource.title} to whiteboard`}
                    >
                      <HiPlusSmall className="h-5 w-5" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
