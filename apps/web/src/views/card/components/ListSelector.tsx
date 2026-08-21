import { t } from "@lingui/core/macro";
import { useState } from "react";

import type { ListStatus } from "~/utils/card-presentation";
import CheckboxDropdown from "~/components/CheckboxDropdown";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import { isOpenSubtasksConfirmationError } from "~/utils/card-workspace";
import { invalidateCard } from "~/utils/cardInvalidation";
import { OpenSubtasksConfirmationDialog } from "./OpenSubtasksConfirmationDialog";

interface ListSelectorProps {
  cardPublicId: string;
  lists: {
    key: string;
    value: string;
    selected: boolean;
    status?: ListStatus | null;
  }[];
  isLoading: boolean;
  disabled?: boolean;
  subtaskSummary?: {
    total: number;
    completed: number;
  };
}

export default function ListSelector({
  cardPublicId,
  lists,
  isLoading,
  disabled = false,
  subtaskSummary,
}: ListSelectorProps) {
  const utils = api.useUtils();
  const [pendingListPublicId, setPendingListPublicId] = useState<string | null>(
    null,
  );

  const { showPopup } = usePopup();

  const updateCardList = api.card.update.useMutation({
    onMutate: async (newList) => {
      await utils.card.byId.cancel();

      const previousCard = utils.card.byId.getData({ cardPublicId });
      const nextListPublicId = newList.listPublicId;

      if (!nextListPublicId) return { previousCard };

      utils.card.byId.setData({ cardPublicId }, (oldCard) => {
        if (!oldCard) return oldCard;

        return {
          ...oldCard,
          list: {
            ...oldCard.list,
            publicId: nextListPublicId,
            name: oldCard.list.name,
            board: oldCard.list.board,
          },
        };
      });

      return { previousCard };
    },
    onError: (error, newList, context) => {
      utils.card.byId.setData({ cardPublicId }, context?.previousCard);
      if (isOpenSubtasksConfirmationError(error) && newList.listPublicId) {
        setPendingListPublicId(newList.listPublicId);
        return;
      }
      showPopup({
        header: t`Unable to update list`,
        message: t`Please try again later, or contact customer support.`,
        icon: "error",
      });
    },
    onSettled: async () => {
      await invalidateCard(utils, cardPublicId);
      await utils.board.byId.invalidate();
    },
  });

  const selectedList = lists.find((list) => list.selected);
  const openSubtaskCount = Math.max(
    0,
    (subtaskSummary?.total ?? 0) - (subtaskSummary?.completed ?? 0),
  );

  const moveCard = (listPublicId: string, confirmed = false) => {
    if (listPublicId === selectedList?.key) return;
    const targetList = lists.find((list) => list.key === listPublicId);
    if (
      !confirmed &&
      selectedList?.status !== "done" &&
      targetList?.status === "done" &&
      openSubtaskCount > 0
    ) {
      setPendingListPublicId(listPublicId);
      return;
    }

    updateCardList.mutate({
      cardPublicId,
      listPublicId,
      index: 0,
      ...(confirmed ? { confirmOpenSubtasks: true } : {}),
    });
  };

  return (
    <>
      {isLoading ? (
        <div className="flex w-full">
          <div className="h-full w-[150px] animate-pulse rounded-[5px] bg-light-300 dark:bg-dark-300" />
        </div>
      ) : (
        <CheckboxDropdown
          items={lists}
          handleSelect={(_, member) => {
            moveCard(member.key);
          }}
          disabled={disabled}
          asChild
        >
          <div
            className={`flex h-full w-full items-center rounded-[5px] border-[1px] border-light-50 py-1 pl-2 text-left text-xs text-neutral-900 dark:border-dark-50 dark:text-dark-1000 ${disabled ? "cursor-not-allowed opacity-60" : "hover:border-light-300 hover:bg-light-200 dark:hover:border-dark-200 dark:hover:bg-dark-100"}`}
          >
            {selectedList?.value}
          </div>
        </CheckboxDropdown>
      )}
      <OpenSubtasksConfirmationDialog
        isOpen={pendingListPublicId !== null}
        openCount={openSubtaskCount}
        isLoading={updateCardList.isPending}
        onCancel={() => setPendingListPublicId(null)}
        onConfirm={() => {
          if (!pendingListPublicId) return;
          const destination = pendingListPublicId;
          setPendingListPublicId(null);
          moveCard(destination, true);
        }}
      />
    </>
  );
}
