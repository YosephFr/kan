import { t } from "@lingui/core/macro";
import { motion } from "framer-motion";
import { HiOutlineArrowRightCircle, HiOutlineXMark } from "react-icons/hi2";

import Button from "~/components/Button";

interface CardSelectionToolbarProps {
  selectedCount: number;
  onCancel: () => void;
  onMove: () => void;
}

export function CardSelectionToolbar({
  selectedCount,
  onCancel,
  onMove,
}: CardSelectionToolbarProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-3 sm:px-6"
      role="region"
      aria-label={t`Card selection actions`}
    >
      <div className="pointer-events-auto flex w-full max-w-xl flex-col gap-3 rounded-md border border-light-500 bg-light-50 p-3 shadow-xl dark:border-dark-500 dark:bg-dark-200 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-light-1000 dark:text-dark-1000">
            {t`${selectedCount} selected cards`}
          </p>
          <p className="text-xs text-light-800 dark:text-dark-800">
            {selectedCount > 0
              ? t`They will move together to one destination list.`
              : t`Choose the cards you want to move.`}
          </p>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            iconLeft={<HiOutlineXMark className="h-4 w-4" />}
            onClick={onCancel}
          >
            {t`Cancel`}
          </Button>
          <Button
            type="button"
            size="sm"
            iconLeft={<HiOutlineArrowRightCircle className="h-4 w-4" />}
            onClick={onMove}
            disabled={selectedCount === 0}
          >
            {t`Move`}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
