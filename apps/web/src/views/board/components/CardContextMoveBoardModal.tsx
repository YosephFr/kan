import { t } from "@lingui/core/macro";
import { useState } from "react";
import { HiChevronDown, HiOutlineExclamationTriangle } from "react-icons/hi2";

import Button from "~/components/Button";
import { useModal } from "~/providers/modal";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import { invalidateCard } from "~/utils/cardInvalidation";

const selectClassName =
  "block w-full appearance-none rounded-md border-0 bg-white/5 py-2 pl-3 pr-9 text-sm text-light-1000 shadow-sm ring-1 ring-inset ring-light-600 focus:ring-2 focus:ring-inset focus:ring-light-700 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:text-dark-1000 dark:ring-dark-700 dark:focus:ring-dark-700";

export function CardContextMoveBoardModal() {
  const { entityId: cardPublicId, closeModal } = useModal();
  const { showPopup } = usePopup();
  const utils = api.useUtils();
  const [boardPublicId, setBoardPublicId] = useState("");
  const [listPublicId, setListPublicId] = useState("");

  const {
    data: card,
    isLoading: isCardLoading,
    isError: didCardFail,
  } = api.card.byId.useQuery(
    { cardPublicId },
    { enabled: !!cardPublicId && cardPublicId.length >= 12 },
  );

  const workspacePublicId = card?.list.board.workspace.publicId ?? "";
  const currentBoardPublicId = card?.list.board.publicId;
  const {
    data: workspaceBoards,
    isLoading: areBoardsLoading,
    isError: didBoardsFail,
  } = api.board.all.useQuery(
    { workspacePublicId, type: "regular", archived: false },
    { enabled: workspacePublicId.length >= 12 },
  );

  const boards = (workspaceBoards ?? []).filter(
    (board) => board.publicId !== currentBoardPublicId,
  );
  const selectedBoard = boards.find(
    (board) => board.publicId === boardPublicId,
  );
  const lists = selectedBoard?.lists ?? [];
  const isLoading = isCardLoading || areBoardsLoading;
  const didLoadFail = didCardFail || didBoardsFail;
  const hasLabels = (card?.labels.length ?? 0) > 0;

  const moveCard = api.card.update.useMutation({
    onSuccess: () => {
      showPopup({
        header: t`Card moved`,
        message: t`The card was moved to ${selectedBoard?.name ?? ""}.`,
        icon: "success",
      });
      closeModal();
    },
    onError: () => {
      showPopup({
        header: t`Unable to move card`,
        message: t`Please try again.`,
        icon: "error",
      });
    },
    onSettled: async () => {
      if (cardPublicId) await invalidateCard(utils, cardPublicId);
      await Promise.all([
        utils.board.byId.invalidate(),
        utils.board.all.invalidate(),
      ]);
    },
  });

  const handleBoardChange = (nextBoardPublicId: string) => {
    setBoardPublicId(nextBoardPublicId);
    setListPublicId("");
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!cardPublicId || !boardPublicId || !listPublicId) return;
    moveCard.mutate({ cardPublicId, listPublicId, index: 0 });
  };

  if (!cardPublicId) return null;

  return (
    <form onSubmit={handleSubmit} className="p-4">
      <h2 className="text-lg font-semibold text-light-1000 dark:text-dark-1000">
        {t`Move to another board`}
      </h2>
      <p className="mt-1 text-sm text-light-800 dark:text-dark-800">
        {t`Choose a board and destination list.`}
      </p>

      <div className="mt-5">
        {isLoading ? (
          <div className="space-y-4" aria-label={t`Loading...`}>
            {[1, 2].map((item) => (
              <div key={item} className="space-y-2">
                <div className="h-4 w-16 animate-pulse rounded bg-light-200 dark:bg-dark-300" />
                <div className="h-10 w-full animate-pulse rounded-md bg-light-200 dark:bg-dark-300" />
              </div>
            ))}
          </div>
        ) : didLoadFail ? (
          <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
            {t`Unable to load boards. Please try again.`}
          </p>
        ) : boards.length === 0 ? (
          <p className="rounded-md border border-light-300 p-3 text-sm text-light-800 dark:border-dark-500 dark:text-dark-800">
            {t`There are no other active boards in this workspace.`}
          </p>
        ) : (
          <div className="space-y-4">
            <div>
              <label
                htmlFor="move-card-board"
                className="mb-1 block text-sm font-medium text-light-900 dark:text-dark-900"
              >
                {t`Board`}
              </label>
              <div className="relative">
                <select
                  id="move-card-board"
                  value={boardPublicId}
                  onChange={(event) => handleBoardChange(event.target.value)}
                  className={selectClassName}
                >
                  <option value="" disabled>
                    {t`Select a board`}
                  </option>
                  {boards.map((board) => (
                    <option key={board.publicId} value={board.publicId}>
                      {board.name}
                    </option>
                  ))}
                </select>
                <HiChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-light-700 dark:text-dark-700" />
              </div>
            </div>

            <div>
              <label
                htmlFor="move-card-list"
                className="mb-1 block text-sm font-medium text-light-900 dark:text-dark-900"
              >
                {t`List`}
              </label>
              <div className="relative">
                <select
                  id="move-card-list"
                  value={listPublicId}
                  onChange={(event) => setListPublicId(event.target.value)}
                  disabled={!boardPublicId || lists.length === 0}
                  className={selectClassName}
                >
                  <option value="" disabled>
                    {t`Select a list`}
                  </option>
                  {lists.map((list) => (
                    <option key={list.publicId} value={list.publicId}>
                      {list.name}
                    </option>
                  ))}
                </select>
                <HiChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-light-700 dark:text-dark-700" />
              </div>
              {boardPublicId && lists.length === 0 && (
                <p className="mt-2 text-sm text-light-700 dark:text-dark-700">
                  {t`This board has no lists.`}
                </p>
              )}
            </div>

            {boardPublicId && hasLabels && (
              <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                <HiOutlineExclamationTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  {t`This card's labels will be removed because labels belong to the current board.`}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={closeModal}>
          {t`Cancel`}
        </Button>
        <Button
          type="submit"
          variant="primary"
          isLoading={moveCard.isPending}
          disabled={
            !boardPublicId ||
            !listPublicId ||
            isLoading ||
            didLoadFail ||
            moveCard.isPending
          }
        >
          {t`Move card`}
        </Button>
      </div>
    </form>
  );
}
