import { t } from "@lingui/core/macro";
import { HiOutlineEye } from "react-icons/hi2";

export function PublicResourceVisibilityNotice({
  resourceCount,
  driveOnly = false,
}: {
  resourceCount?: number;
  driveOnly?: boolean;
}) {
  return (
    <div
      role="alert"
      className="flex gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-left dark:border-amber-800 dark:bg-amber-950/40"
    >
      <HiOutlineEye
        className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300"
        aria-hidden="true"
      />
      <div>
        <p className="text-sm font-medium text-amber-950 dark:text-amber-100">
          {resourceCount === undefined
            ? driveOnly
              ? t`Drive links will be copied into a public board.`
              : t`Resources will become visible on a public board.`
            : driveOnly
              ? resourceCount === 1
                ? t`1 Drive link will be copied into a public board.`
                : t`${resourceCount} Drive links will be copied into a public board.`
              : resourceCount === 1
                ? t`1 resource will become visible on a public board.`
                : t`${resourceCount} resources will become visible on a public board.`}
        </p>
        <p className="mt-1 text-xs leading-5 text-amber-900 dark:text-amber-200">
          {driveOnly
            ? t`Anyone with the board link can open these resources, subject to their Google permissions.`
            : t`Anyone with the board link can view uploaded files and open Drive resources allowed by Google.`}
        </p>
      </div>
    </div>
  );
}
