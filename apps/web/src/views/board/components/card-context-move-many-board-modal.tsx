import { t } from "@lingui/core/macro";
import { useState } from "react";
import {
  HiChevronDown,
  HiOutlineExclamationTriangle,
  HiOutlineUserGroup,
} from "react-icons/hi2";

import Button from "~/components/Button";
import { PublicResourceVisibilityNotice } from "~/components/PublicResourceVisibilityNotice";
import { useModal } from "~/providers/modal";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import {
  isOpenSubtasksConfirmationError,
  isPublicVisibilityAcknowledgementError,
} from "~/utils/card-workspace";
import { OpenSubtasksConfirmationDialog } from "~/views/card/components/OpenSubtasksConfirmationDialog";

const selectClassName =
  "block w-full appearance-none rounded-md border-0 bg-white/5 py-2 pl-3 pr-9 text-sm text-light-1000 shadow-sm ring-1 ring-inset ring-light-600 focus:ring-2 focus:ring-inset focus:ring-light-700 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:text-dark-1000 dark:ring-dark-700 dark:focus:ring-dark-700";

interface CardContextMoveManyBoardModalProps {
  cardPublicIds: string[];
  currentBoardPublicId: string;
  workspacePublicId: string;
  hasLabels: boolean;
  openSubtaskCount: number;
  resourceCount: number;
  currentBoardIsPublic: boolean;
  onMoved: () => void;
}

export function CardContextMoveManyBoardModal({
  cardPublicIds,
  currentBoardPublicId,
  workspacePublicId,
  hasLabels,
  openSubtaskCount,
  resourceCount,
  currentBoardIsPublic,
  onMoved,
}: CardContextMoveManyBoardModalProps) {
  const { closeModal } = useModal();
  const { showPopup } = usePopup();
  const utils = api.useUtils();
  const [boardPublicId, setBoardPublicId] = useState("");
  const [listPublicId, setListPublicId] = useState("");
  const [isConfirmingOpenSubtasks, setIsConfirmingOpenSubtasks] =
    useState(false);
  const [hasConfirmedOpenSubtasks, setHasConfirmedOpenSubtasks] =
    useState(false);
  const [
    serverRequiresPublicAcknowledgement,
    setServerRequiresPublicAcknowledgement,
  ] = useState(false);
  const {
    data: workspaceBoards,
    isLoading,
    isError,
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
  const { data: selectedBoardDetails } = api.board.byId.useQuery(
    { boardPublicId, type: "regular" },
    { enabled: boardPublicId.length >= 12 },
  );
  const lists = selectedBoard?.lists ?? [];
  const requiresPublicAcknowledgement =
    serverRequiresPublicAcknowledgement ||
    (!currentBoardIsPublic &&
      selectedBoardDetails?.visibility === "public" &&
      resourceCount > 0);
  const moveCards = api.card.moveMany.useMutation({
    onSuccess: () => {
      showPopup({
        header: t`Cards moved`,
        message: t`${cardPublicIds.length} cards were moved to ${selectedBoard?.name ?? ""}.`,
        icon: "success",
      });
      onMoved();
      closeModal();
    },
    onError: (error) => {
      if (isOpenSubtasksConfirmationError(error)) {
        setIsConfirmingOpenSubtasks(true);
        return;
      }
      if (isPublicVisibilityAcknowledgementError(error)) {
        setServerRequiresPublicAcknowledgement(true);
        return;
      }
      showPopup({
        header: t`Unable to move cards`,
        message: t`No cards were moved. Please try again.`,
        icon: "error",
      });
    },
    onSettled: async () => {
      await Promise.all([
        utils.board.byId.invalidate(),
        utils.board.all.invalidate(),
        utils.card.byId.invalidate(),
      ]);
    },
  });

  const handleBoardChange = (nextBoardPublicId: string) => {
    setBoardPublicId(nextBoardPublicId);
    setListPublicId("");
    setHasConfirmedOpenSubtasks(false);
    setServerRequiresPublicAcknowledgement(false);
  };

  const performMove = (confirmed = hasConfirmedOpenSubtasks) => {
    if (!boardPublicId || !listPublicId || cardPublicIds.length === 0) {
      return;
    }

    moveCards.mutate({
      cardPublicIds,
      listPublicId,
      ...(confirmed ? { confirmOpenSubtasks: true } : {}),
      publicVisibilityAcknowledged: requiresPublicAcknowledgement,
    });
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const selectedList = lists.find((list) => list.publicId === listPublicId);
    if (
      selectedList?.status === "done" &&
      openSubtaskCount > 0 &&
      !hasConfirmedOpenSubtasks
    ) {
      setIsConfirmingOpenSubtasks(true);
      return;
    }
    performMove();
  };

  return (
    <>
      <form onSubmit={handleSubmit} className="p-4">
        <h2 className="text-lg font-semibold text-light-1000 dark:text-dark-1000">
          {t`Move selected cards`}
        </h2>
        <p className="mt-1 text-sm text-light-800 dark:text-dark-800">
          {t`${cardPublicIds.length} cards will move together to one destination list.`}
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
          ) : isError ? (
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
                  htmlFor="move-many-card-board"
                  className="mb-1 block text-sm font-medium text-light-900 dark:text-dark-900"
                >
                  {t`Board`}
                </label>
                <div className="relative">
                  <select
                    id="move-many-card-board"
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
                  htmlFor="move-many-card-list"
                  className="mb-1 block text-sm font-medium text-light-900 dark:text-dark-900"
                >
                  {t`List`}
                </label>
                <div className="relative">
                  <select
                    id="move-many-card-list"
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

              <div className="flex gap-2 rounded-md border border-light-300 p-3 text-sm text-light-900 dark:border-dark-500 dark:text-dark-900">
                <HiOutlineUserGroup className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{t`All assigned members will remain on every card.`}</p>
              </div>

              {hasLabels && (
                <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                  <HiOutlineExclamationTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>
                    {t`Labels on selected cards will be removed because labels belong to the current board.`}
                  </p>
                </div>
              )}

              {requiresPublicAcknowledgement && (
                <PublicResourceVisibilityNotice
                  resourceCount={resourceCount || undefined}
                />
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
            isLoading={moveCards.isPending}
            disabled={
              !boardPublicId ||
              !listPublicId ||
              isLoading ||
              isError ||
              moveCards.isPending
            }
          >
            {requiresPublicAcknowledgement
              ? t`Confirm and move cards`
              : t`Move cards`}
          </Button>
        </div>
      </form>
      <OpenSubtasksConfirmationDialog
        isOpen={isConfirmingOpenSubtasks}
        openCount={openSubtaskCount}
        isLoading={moveCards.isPending}
        onCancel={() => setIsConfirmingOpenSubtasks(false)}
        onConfirm={() => {
          setIsConfirmingOpenSubtasks(false);
          setHasConfirmedOpenSubtasks(true);
          performMove(true);
        }}
      />
    </>
  );
}
