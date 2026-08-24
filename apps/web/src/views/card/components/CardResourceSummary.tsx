import type { ParsedUrlQuery } from "querystring";
import { useRouter } from "next/router";
import { t } from "@lingui/core/macro";
import { HiChevronRight, HiOutlinePaperClip } from "react-icons/hi2";

import { getCardWorkspaceQueryValue } from "~/utils/card-workspace";

interface CardResourceSummaryProps {
  total: number;
  uploads: number;
  driveLinks: number;
  webLinks: number;
}

export function CardResourceSummary({
  total,
  uploads,
  driveLinks,
  webLinks,
}: CardResourceSummaryProps) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        const query: ParsedUrlQuery = {
          ...router.query,
          vista: getCardWorkspaceQueryValue("files"),
        };
        delete query.view;
        delete query.recurso;
        void router.replace({ pathname: router.pathname, query }, undefined, {
          shallow: true,
        });
      }}
      className="flex w-full items-center gap-3 border-y border-light-300 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:border-dark-400 dark:focus-visible:ring-dark-800"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-light-200 text-light-800 dark:bg-dark-200 dark:text-dark-800">
        <HiOutlinePaperClip className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-light-1000 dark:text-dark-1000">
          {total === 1 ? t`1 resource` : t`${total} resources`}
        </span>
        <span className="mt-0.5 block text-xs text-light-700 dark:text-dark-700">
          {t`${uploads} uploads · ${driveLinks} Drive links · ${webLinks} web links`}
        </span>
      </span>
      <HiChevronRight className="h-4 w-4 shrink-0 text-light-600 dark:text-dark-600" />
    </button>
  );
}
