import { t } from "@lingui/core/macro";
import { useState } from "react";

import { useModal } from "~/providers/modal";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import { isOpenSubtasksConfirmationError } from "~/utils/card-workspace";
import { invalidateCard } from "~/utils/cardInvalidation";
import { OpenSubtasksConfirmationDialog } from "~/views/card/components/OpenSubtasksConfirmationDialog";

export function CardContextMoveListModal() {
  const { entityId: cardPublicId, closeModal } = useModal();
  const { showPopup } = usePopup();
  const utils = api.useUtils();
  const [pendingListPublicId, setPendingListPublicId] = useState<string | null>(
    null,
  );

  const { data: card, isLoading } = api.card.byId.useQuery(
    { cardPublicId },
    { enabled: !!cardPublicId && cardPublicId.length >= 12 },
  );

  const updateCardList = api.card.update.useMutation({
    onMutate: async (vars) => {
      if (!cardPublicId) return undefined;
      await utils.card.byId.cancel();
      const previous = utils.card.byId.getData({ cardPublicId });
      utils.card.byId.setData({ cardPublicId }, (old) => {
        if (!old) return old;
        const list = old.list.board.lists.find(
          (l) => l.publicId === vars.listPublicId,
        );
        if (!list) return old;
        return {
          ...old,
          list: { ...old.list, publicId: list.publicId, name: list.name },
        };
      });
      return { previous };
    },
    onError: (error, vars, ctx) => {
      if (cardPublicId && ctx?.previous) {
        utils.card.byId.setData({ cardPublicId }, ctx.previous);
      }
      if (isOpenSubtasksConfirmationError(error) && vars.listPublicId) {
        setPendingListPublicId(vars.listPublicId);
        return;
      }
      showPopup({
        header: t`Unable to move card`,
        message: t`Please try again.`,
        icon: "error",
      });
    },
    onSettled: async () => {
      if (cardPublicId) {
        await invalidateCard(utils, cardPublicId);
        await utils.board.byId.invalidate();
      }
    },
  });

  const lists = card?.list.board.lists ?? [];
  const currentListPublicId = card?.list.publicId;
  const openSubtaskCount = Math.max(
    0,
    (card?.subtaskSummary.total ?? 0) - (card?.subtaskSummary.completed ?? 0),
  );

  const handleSelectList = (listPublicId: string, confirmed = false) => {
    if (listPublicId === currentListPublicId || !cardPublicId) return;
    const destination = lists.find((list) => list.publicId === listPublicId);
    if (
      !confirmed &&
      card?.list.status !== "done" &&
      destination?.status === "done" &&
      openSubtaskCount > 0
    ) {
      setPendingListPublicId(listPublicId);
      return;
    }
    updateCardList.mutate(
      {
        cardPublicId,
        listPublicId,
        index: 0,
        ...(confirmed ? { confirmOpenSubtasks: true } : {}),
      },
      { onSuccess: closeModal },
    );
  };

  if (!cardPublicId) return null;

  return (
    <>
      <div className="p-4">
        <h2 className="mb-4 text-lg font-semibold text-light-1000 dark:text-dark-1000">
          {t`Move to list`}
        </h2>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-10 w-full animate-pulse rounded bg-light-200 dark:bg-dark-300"
              />
            ))}
          </div>
        ) : (
          <div className="scrollbar-track-rounded-[4px] scrollbar-thumb-rounded-[4px] scrollbar-w-[8px] max-h-[60vh] overflow-y-auto pr-1 scrollbar scrollbar-track-light-200 scrollbar-thumb-light-400 dark:scrollbar-track-dark-100 dark:scrollbar-thumb-dark-600">
            <ul className="space-y-1">
              {lists.map((list) => (
                <li key={list.publicId}>
                  <button
                    type="button"
                    onClick={() => handleSelectList(list.publicId)}
                    disabled={list.publicId === currentListPublicId}
                    className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-light-200 disabled:opacity-50 dark:hover:bg-dark-400"
                  >
                    {list.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <OpenSubtasksConfirmationDialog
        isOpen={pendingListPublicId !== null}
        openCount={openSubtaskCount}
        isLoading={updateCardList.isPending}
        onCancel={() => setPendingListPublicId(null)}
        onConfirm={() => {
          if (!pendingListPublicId) return;
          const destination = pendingListPublicId;
          setPendingListPublicId(null);
          handleSelectList(destination, true);
        }}
      />
    </>
  );
}
