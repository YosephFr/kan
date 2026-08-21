import { t } from "@lingui/core/macro";
import { HiOutlineExclamationTriangle } from "react-icons/hi2";

export function DuplicateResourcesNotice() {
  return (
    <div className="flex gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-left dark:border-amber-800 dark:bg-amber-950/40">
      <HiOutlineExclamationTriangle
        className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300"
        aria-hidden="true"
      />
      <div>
        <p className="text-sm font-medium text-amber-950 dark:text-amber-100">
          {t`Uploaded files and linked resources will not be copied.`}
        </p>
        <p className="mt-1 text-xs leading-5 text-amber-900 dark:text-amber-200">
          {t`The duplicate keeps the structure, subtasks and checklists. Files stay with the original.`}
        </p>
      </div>
    </div>
  );
}
