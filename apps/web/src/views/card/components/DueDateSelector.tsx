import { t } from "@lingui/core/macro";
import { format } from "date-fns";
import { useCallback, useEffect, useRef, useState } from "react";
import { HiMiniPlus } from "react-icons/hi2";

import DateSelector from "~/components/DateSelector";
import { useLocalisation } from "~/hooks/useLocalisation";
import { usePopup } from "~/providers/popup";
import { useWorkspace } from "~/providers/workspace";
import { api } from "~/utils/api";
import { invalidateCard } from "~/utils/cardInvalidation";

interface DueDateSelectorProps {
  cardPublicId: string;
  dueDate: Date | null | undefined;
  isLoading?: boolean;
  disabled?: boolean;
}

export function DueDateSelector({
  cardPublicId,
  dueDate,
  isLoading = false,
  disabled = false,
}: DueDateSelectorProps) {
  const { showPopup } = usePopup();
  const { dateLocale } = useLocalisation();
  const { workspace } = useWorkspace();
  const utils = api.useUtils();
  const [isOpen, setIsOpen] = useState(false);
  const [pendingDate, setPendingDate] = useState<Date | null | undefined>(
    dueDate,
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Sync pendingDate with dueDate when it changes externally
  useEffect(() => {
    if (!isOpen) {
      setPendingDate(dueDate);
    }
  }, [dueDate, isOpen]);

  const updateDueDate = api.card.update.useMutation({
    onMutate: async (update) => {
      await utils.card.byId.cancel();

      const previousCard = utils.card.byId.getData({ cardPublicId });

      utils.card.byId.setData({ cardPublicId }, (oldCard) => {
        if (!oldCard) return oldCard;

        return {
          ...oldCard,
          dueDate:
            update.dueDate !== undefined ? update.dueDate : oldCard.dueDate,
        };
      });

      return { previousCard };
    },
    onError: (_error, _update, context) => {
      utils.card.byId.setData({ cardPublicId }, context?.previousCard);
      showPopup({
        header: t`Unable to update due date`,
        message: t`Please try again later, or contact customer support.`,
        icon: "error",
      });
    },
    onSettled: async () => {
      await invalidateCard(utils, cardPublicId);
      await utils.board.byId.invalidate();
    },
  });

  const handleDateSelect = (date: Date | undefined) => {
    // Only update local state, don't fire mutation
    setPendingDate(date ?? null);
  };

  const handleApply = () => {
    // Only fire mutation if date actually changed
    const pendingIsNull = pendingDate === null || pendingDate === undefined;
    const dueIsNull = dueDate === null || dueDate === undefined;

    let dateChanged = false;
    if (pendingIsNull && !dueIsNull) {
      dateChanged = true;
    } else if (!pendingIsNull && dueIsNull) {
      dateChanged = true;
    } else if (!pendingIsNull && !dueIsNull) {
      // Both are non-null at this point
      if (pendingDate instanceof Date && dueDate instanceof Date) {
        dateChanged = pendingDate.getTime() !== dueDate.getTime();
      }
    }

    setIsOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());

    // Fire mutation if date changed (optimistic update will handle UI)
    if (dateChanged) {
      updateDueDate.mutate({
        cardPublicId,
        dueDate: pendingDate ?? null,
      });
    }
  };

  const handleCancel = useCallback(() => {
    setPendingDate(dueDate);
    setIsOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, [dueDate]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        handleCancel();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled])",
        ) ?? [],
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    window.requestAnimationFrame(() => {
      dialogRef.current
        ?.querySelector<HTMLElement>(
          "button:not([disabled]), input:not([disabled])",
        )
        ?.focus();
    });
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleCancel, isOpen]);

  return (
    <div className="relative flex w-full items-center text-left">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (disabled) return;
          if (isOpen) {
            handleCancel();
          } else {
            setPendingDate(dueDate);
            setIsOpen(true);
          }
        }}
        disabled={isLoading || disabled}
        className={`flex h-full w-full items-center rounded-[5px] border-[1px] border-light-50 py-1 pl-2 text-left text-xs text-neutral-900 dark:border-dark-50 dark:text-dark-1000 ${disabled ? "cursor-not-allowed opacity-60" : "hover:border-light-300 hover:bg-light-200 dark:hover:border-dark-200 dark:hover:bg-dark-100"}`}
      >
        {dueDate ? (
          <span>
            {format(dueDate, "MMM d, yyyy · HH:mm", { locale: dateLocale })}
          </span>
        ) : (
          <>
            <HiMiniPlus size={22} className="pr-2" />
            {t`Set due date`}
          </>
        )}
      </button>
      {isOpen && !disabled && (
        <>
          <div className="fixed inset-0 z-10" onClick={handleCancel} />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={t`Set due date`}
            className="fixed left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-md border border-light-200 bg-light-50 shadow-lg dark:border-dark-200 dark:bg-dark-100 sm:absolute sm:-left-8 sm:top-full sm:mt-2 sm:translate-x-0 sm:translate-y-0"
            onClick={(e) => {
              e.stopPropagation();
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
            }}
          >
            <DateSelector
              selectedDate={pendingDate ?? undefined}
              onDateSelect={handleDateSelect}
              weekStartsOn={workspace.weekStartDay}
              showTime
            />
            <div className="flex justify-end gap-2 border-t border-light-200 px-4 py-3 dark:border-dark-300">
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-light-900 hover:bg-light-200 dark:text-dark-900 dark:hover:bg-dark-300"
              >
                {t`Cancel`}
              </button>
              <button
                type="button"
                onClick={handleApply}
                className="rounded-md bg-light-1000 px-3 py-1.5 text-xs font-medium text-light-50 hover:bg-light-900 dark:bg-dark-1000 dark:text-dark-50 dark:hover:bg-dark-900"
              >
                {t`Apply`}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
