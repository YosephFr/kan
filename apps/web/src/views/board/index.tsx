import type { DropResult } from "react-beautiful-dnd";
import { useParams } from "next/navigation";
import { useRouter } from "next/router";
import { t } from "@lingui/core/macro";
import { keepPreviousData } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { DragDropContext } from "react-beautiful-dnd";
import { useForm } from "react-hook-form";
import { HiOutlineSquare3Stack3D } from "react-icons/hi2";

import type { UpdateBoardInput } from "@kan/api/types";

import type { CardContextMenuAction } from "./components/CardContextMenu";
import Button from "~/components/Button";
import { DeleteLabelConfirmation } from "~/components/DeleteLabelConfirmation";
import { LabelForm } from "~/components/LabelForm";
import Modal from "~/components/modal";
import { PageHead } from "~/components/PageHead";
import PatternedBackground from "~/components/PatternedBackground";
import { StrictModeDroppable as Droppable } from "~/components/StrictModeDroppable";
import { Tooltip } from "~/components/Tooltip";
import { EditYouTubeModal } from "~/components/YouTubeEmbed/EditYouTubeModal";
import { useDragToScroll } from "~/hooks/useDragToScroll";
import { usePermissions } from "~/hooks/usePermissions";
import { useScrollRestore } from "~/hooks/useScrollRestore";
import { useKeyboardShortcut } from "~/providers/keyboard-shortcuts";
import { useModal } from "~/providers/modal";
import { usePopup } from "~/providers/popup";
import { useWorkspace } from "~/providers/workspace";
import { api } from "~/utils/api";
import { isCardPriority } from "~/utils/card-presentation";
import { isOpenSubtasksConfirmationError } from "~/utils/card-workspace";
import { formatToArray } from "~/utils/helpers";
import { DeleteCardConfirmation } from "~/views/card/components/DeleteCardConfirmation";
import { OpenSubtasksConfirmationDialog } from "~/views/card/components/OpenSubtasksConfirmationDialog";
import { BoardCard } from "./components/board-card";
import { BoardHeaderActions } from "./components/board-header-actions";
import { CardContextMoveManyBoardModal } from "./components/card-context-move-many-board-modal";
import { CardSelectionToolbar } from "./components/card-selection-toolbar";
import { CardContextAppearanceModal } from "./components/CardContextAppearanceModal";
import { CardContextDueDateModal } from "./components/CardContextDueDateModal";
import { CardContextDuplicateModal } from "./components/CardContextDuplicateModal";
import { CardContextLabelsModal } from "./components/CardContextLabelsModal";
import { CardContextMembersModal } from "./components/CardContextMembersModal";
import { CardContextMenu } from "./components/CardContextMenu";
import { CardContextMoveBoardModal } from "./components/CardContextMoveBoardModal";
import { CardContextMoveListModal } from "./components/CardContextMoveListModal";
import { DeleteBoardConfirmation } from "./components/DeleteBoardConfirmation";
import { DeleteListConfirmation } from "./components/DeleteListConfirmation";
import List from "./components/List";
import { MoveBoardForm } from "./components/MoveBoardForm";
import { NewCardForm } from "./components/NewCardForm";
import { NewListForm } from "./components/NewListForm";
import { NewTemplateForm } from "./components/NewTemplateForm";
import { UpdateBoardSlugForm } from "./components/UpdateBoardSlugForm";

type PublicListId = string;

export default function BoardPage({ isTemplate }: { isTemplate?: boolean }) {
  const params = useParams() as { boardId: string | string[] } | null;
  const router = useRouter();
  const utils = api.useUtils();
  const { showPopup } = usePopup();
  const { workspace } = useWorkspace();
  const { openModal, modalContentType, entityId, isOpen, setModalState } =
    useModal();
  const [selectedPublicListId, setSelectedPublicListId] =
    useState<PublicListId>("");
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isSelectingCards, setIsSelectingCards] = useState(false);
  const [selectedCardPublicIds, setSelectedCardPublicIds] = useState<string[]>(
    [],
  );
  const [pendingCardMove, setPendingCardMove] = useState<{
    cardPublicId: string;
    listPublicId: string;
    index: number;
    openCount: number;
  } | null>(null);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    cardPublicId: string;
  } | null>(null);

  const { ref: scrollRef, onMouseDown } = useDragToScroll({
    enabled: true,
    direction: "horizontal",
  });

  const { canCreateList, canEditList, canEditCard, canEditBoard } =
    usePermissions();

  const { tooltipContent: createListShortcutTooltipContent } =
    useKeyboardShortcut({
      type: "PRESS",
      stroke: { key: "C" },
      action: () => boardId && canCreateList && openNewListForm(boardId),
      description: t`Create new list`,
      group: "ACTIONS",
    });

  const boardId = params?.boardId
    ? Array.isArray(params.boardId)
      ? params.boardId[0]
      : params.boardId
    : null;

  const updateBoard = api.board.update.useMutation();

  const { register, handleSubmit, setValue } = useForm<UpdateBoardInput>({
    values: {
      boardPublicId: boardId ?? "",
      name: "",
    },
  });

  const onSubmit = (values: UpdateBoardInput) => {
    updateBoard.mutate({
      boardPublicId: values.boardPublicId,
      name: values.name,
    });
  };

  const semanticFilters = formatToArray(router.query.dueDate) as (
    | "overdue"
    | "today"
    | "tomorrow"
    | "next-week"
    | "next-month"
    | "no-due-date"
  )[];

  const boardType: "regular" | "template" = isTemplate ? "template" : "regular";

  const queryParams = {
    boardPublicId: boardId ?? "",
    members: formatToArray(router.query.members),
    labels: formatToArray(router.query.labels),
    lists: formatToArray(router.query.lists),
    priorities: formatToArray(router.query.priorities).filter(isCardPriority),
    ...(semanticFilters.length > 0 && {
      dueDateFilters: semanticFilters,
    }),
    type: boardType,
  };

  const {
    data: boardData,
    isSuccess,
    isLoading: isQueryLoading,
    error,
  } = api.board.byId.useQuery(queryParams, {
    enabled: !!boardId,
    placeholderData: keepPreviousData,
  });

  // Redirect to 404 if board doesn't exist
  useEffect(() => {
    if (
      router.isReady &&
      boardId &&
      !isQueryLoading &&
      (error?.data?.code === "NOT_FOUND" || !boardData)
    ) {
      void router.replace("/404");
    }
  }, [router, boardId, isQueryLoading, error, boardData]);

  const refetchBoard = async () => {
    if (boardId) await utils.board.byId.refetch({ boardPublicId: boardId });
  };

  useEffect(() => {
    if (boardId) {
      setIsInitialLoading(false);
    }
  }, [boardId]);

  const isLoading = isInitialLoading || isQueryLoading;
  const selectedCardPublicIdSet = new Set(selectedCardPublicIds);
  const orderedSelectedCardPublicIds =
    boardData?.lists.flatMap((list) =>
      list.cards
        .filter((card) => selectedCardPublicIdSet.has(card.publicId))
        .map((card) => card.publicId),
    ) ?? [];
  const selectedCardsHaveLabels =
    boardData?.lists.some((list) =>
      list.cards.some(
        (card) =>
          selectedCardPublicIdSet.has(card.publicId) && card.labels.length > 0,
      ),
    ) ?? false;
  const selectedOpenSubtaskCount =
    boardData?.lists
      .filter((list) => list.status !== "done")
      .flatMap((list) => list.cards)
      .filter((card) => selectedCardPublicIdSet.has(card.publicId))
      .reduce(
        (total, card) =>
          total +
          Math.max(
            0,
            card.subtaskSummary.total - card.subtaskSummary.completed,
          ),
        0,
      ) ?? 0;
  const selectedResourceCount =
    boardData?.lists
      .flatMap((list) => list.cards)
      .filter((card) => selectedCardPublicIdSet.has(card.publicId))
      .reduce((total, card) => total + card.resourceSummary.total, 0) ?? 0;

  useEffect(() => {
    setIsSelectingCards(false);
    setSelectedCardPublicIds([]);
  }, [boardId]);

  useScrollRestore(
    boardId,
    scrollRef,
    router,
    !isLoading && (boardData?.lists.length ?? 0) > 0,
  );

  const updateListMutation = api.list.update.useMutation({
    onMutate: async (args) => {
      await utils.board.byId.cancel();

      const currentState = utils.board.byId.getData(queryParams);

      utils.board.byId.setData(queryParams, (oldBoard) => {
        if (!oldBoard) return oldBoard;

        const updatedLists = Array.from(oldBoard.lists);

        const sourceList = updatedLists.find(
          (list) => list.publicId === args.listPublicId,
        );

        const currentIndex = sourceList?.index;

        if (currentIndex === undefined) return oldBoard;

        const removedList = updatedLists.splice(currentIndex, 1)[0];

        if (removedList && args.index !== undefined) {
          updatedLists.splice(args.index, 0, removedList);

          return {
            ...oldBoard,
            lists: updatedLists,
          };
        }
      });

      return { previousState: currentState };
    },
    onError: (_error, _newList, context) => {
      utils.board.byId.setData(queryParams, context?.previousState);
      showPopup({
        header: t`Unable to update list`,
        message: t`Please try again later, or contact customer support.`,
        icon: "error",
      });
    },
    onSettled: async () => {
      await utils.board.byId.invalidate(queryParams);
    },
  });

  const updateCardMutation = api.card.update.useMutation({
    onMutate: async (args) => {
      await utils.board.byId.cancel();

      const currentState = utils.board.byId.getData(queryParams);

      utils.board.byId.setData(queryParams, (oldBoard) => {
        if (!oldBoard) return oldBoard;

        const updatedLists = oldBoard.lists.map((list) => ({
          ...list,
          cards: [...list.cards],
        }));

        const sourceList = updatedLists.find((list) =>
          list.cards.some((card) => card.publicId === args.cardPublicId),
        );
        const destinationList = updatedLists.find(
          (list) => list.publicId === args.listPublicId,
        );

        const cardToMove = sourceList?.cards.find(
          (card) => card.publicId === args.cardPublicId,
        );

        if (!cardToMove) return oldBoard;

        const removedCard = sourceList?.cards.splice(cardToMove.index, 1)[0];

        if (
          sourceList &&
          destinationList &&
          removedCard &&
          args.index !== undefined
        ) {
          destinationList.cards.splice(args.index, 0, removedCard);

          sourceList.cards = sourceList.cards.map((card, index) => ({
            ...card,
            index,
          }));
          if (destinationList !== sourceList) {
            destinationList.cards = destinationList.cards.map(
              (card, index) => ({ ...card, index }),
            );
          }

          return {
            ...oldBoard,
            lists: updatedLists,
          };
        }
      });

      return { previousState: currentState };
    },
    onError: (error, newList, context) => {
      utils.board.byId.setData(queryParams, context?.previousState);
      if (
        isOpenSubtasksConfirmationError(error) &&
        newList.listPublicId &&
        newList.index !== undefined
      ) {
        const card = boardData?.lists
          .flatMap((list) => list.cards)
          .find((candidate) => candidate.publicId === newList.cardPublicId);
        setPendingCardMove({
          cardPublicId: newList.cardPublicId,
          listPublicId: newList.listPublicId,
          index: newList.index,
          openCount: Math.max(
            0,
            (card?.subtaskSummary.total ?? 0) -
              (card?.subtaskSummary.completed ?? 0),
          ),
        });
        return;
      }
      showPopup({
        header: t`Unable to update card`,
        message: t`Please try again later, or contact customer support.`,
        icon: "error",
      });
    },
    onSettled: async () => {
      await utils.board.byId.invalidate(queryParams);
    },
  });

  useEffect(() => {
    if (isSuccess) {
      setValue("name", boardData.name || "");
    }
  }, [isSuccess, boardData, setValue]);

  const openNewListForm = (publicBoardId: string) => {
    openModal("NEW_LIST");
    setSelectedPublicListId(publicBoardId);
  };

  const cancelCardSelection = () => {
    setIsSelectingCards(false);
    setSelectedCardPublicIds([]);
    setContextMenu(null);
  };

  const toggleCardSelection = (cardPublicId: string) => {
    setSelectedCardPublicIds((current) =>
      current.includes(cardPublicId)
        ? current.filter((publicId) => publicId !== cardPublicId)
        : [...current, cardPublicId],
    );
  };

  const toggleCardSelectionMode = () => {
    if (isSelectingCards) {
      cancelCardSelection();
      return;
    }

    setContextMenu(null);
    setSelectedCardPublicIds([]);
    setIsSelectingCards(true);
  };

  const openMoveSelectedCardsModal = () => {
    if (orderedSelectedCardPublicIds.length === 0) return;
    openModal("CARD_CONTEXT_MOVE_MANY_BOARD");
  };

  const handleCardContextMenuAction = (action: CardContextMenuAction) => {
    const cardPublicId = contextMenu?.cardPublicId;
    if (!cardPublicId) return;
    setContextMenu(null);
    if (action === "copyLink") {
      const path = isTemplate
        ? `/templates/${boardId}/cards/${cardPublicId}`
        : `/cards/${cardPublicId}`;
      const url = `${typeof window !== "undefined" ? window.location.origin : ""}${path}`;
      void navigator.clipboard.writeText(url).then(
        () => {
          showPopup({
            header: t`Link copied`,
            icon: "success",
            message: t`Card URL copied to clipboard`,
          });
        },
        () => {
          showPopup({
            header: t`Unable to copy link`,
            icon: "error",
            message: t`Please try again.`,
          });
        },
      );
      return;
    }
    if (action === "duplicate") {
      setModalState("CARD_CONTEXT_DUPLICATE", {
        boardPublicId: boardId ?? "",
        isTemplate: !!isTemplate,
      });
      openModal("CARD_CONTEXT_DUPLICATE", cardPublicId);
      return;
    }
    if (action === "delete") {
      openModal("DELETE_CARD", cardPublicId);
      return;
    }
    const modalType =
      action === "members"
        ? "CARD_CONTEXT_MEMBERS"
        : action === "move"
          ? "CARD_CONTEXT_MOVE_LIST"
          : action === "moveBoard"
            ? "CARD_CONTEXT_MOVE_BOARD"
            : action === "labels"
              ? "CARD_CONTEXT_LABELS"
              : action === "priority"
                ? "CARD_CONTEXT_PRIORITY"
                : action === "colour"
                  ? "CARD_CONTEXT_COLOUR"
                  : "CARD_CONTEXT_DUE_DATE";
    openModal(modalType, cardPublicId);
  };

  const onDragEnd = ({
    source,
    destination,
    draggableId,
    type,
  }: DropResult): void => {
    if (!destination || isSelectingCards) {
      return;
    }

    if (type === "LIST" && canEditList) {
      updateListMutation.mutate({
        listPublicId: draggableId,
        index: destination.index,
      });
    }

    if (type === "CARD" && canEditCard) {
      const card = boardData?.lists
        .flatMap((list) => list.cards)
        .find((candidate) => candidate.publicId === draggableId);
      const destinationList = boardData?.lists.find(
        (list) => list.publicId === destination.droppableId,
      );
      const sourceList = boardData?.lists.find(
        (list) => list.publicId === source.droppableId,
      );
      const openCount = Math.max(
        0,
        (card?.subtaskSummary.total ?? 0) -
          (card?.subtaskSummary.completed ?? 0),
      );
      if (
        destinationList?.status === "done" &&
        sourceList?.status !== "done" &&
        source.droppableId !== destination.droppableId &&
        openCount > 0
      ) {
        setPendingCardMove({
          cardPublicId: draggableId,
          listPublicId: destination.droppableId,
          index: destination.index,
          openCount,
        });
        return;
      }
      updateCardMutation.mutate({
        cardPublicId: draggableId,
        listPublicId: destination.droppableId,
        index: destination.index,
      });
    }
  };

  const renderModalContent = () => {
    return (
      <>
        <Modal
          modalSize="sm"
          isVisible={isOpen && modalContentType === "DELETE_BOARD"}
        >
          <DeleteBoardConfirmation
            isTemplate={!!isTemplate}
            boardPublicId={boardId ?? ""}
          />
        </Modal>

        <Modal
          modalSize="sm"
          isVisible={isOpen && modalContentType === "DELETE_LIST"}
        >
          <DeleteListConfirmation
            listPublicId={selectedPublicListId}
            queryParams={queryParams}
          />
        </Modal>

        <Modal
          modalSize="md"
          isVisible={isOpen && modalContentType === "NEW_CARD"}
        >
          <NewCardForm
            isTemplate={!!isTemplate}
            boardPublicId={boardId ?? ""}
            listPublicId={selectedPublicListId}
            queryParams={queryParams}
          />
        </Modal>

        <Modal
          modalSize="sm"
          isVisible={isOpen && modalContentType === "NEW_LIST"}
        >
          <NewListForm
            boardPublicId={boardId ?? ""}
            queryParams={queryParams}
          />
        </Modal>

        <Modal
          modalSize="sm"
          isVisible={isOpen && modalContentType === "NEW_LABEL"}
        >
          <LabelForm boardPublicId={boardId ?? ""} refetch={refetchBoard} />
        </Modal>

        <Modal
          modalSize="sm"
          isVisible={isOpen && modalContentType === "EDIT_LABEL"}
        >
          <LabelForm
            boardPublicId={boardId ?? ""}
            refetch={refetchBoard}
            isEdit
          />
        </Modal>

        <Modal
          modalSize="sm"
          isVisible={isOpen && modalContentType === "DELETE_LABEL"}
        >
          <DeleteLabelConfirmation
            refetch={refetchBoard}
            labelPublicId={entityId}
          />
        </Modal>

        <Modal
          modalSize="sm"
          isVisible={isOpen && modalContentType === "UPDATE_BOARD_SLUG"}
        >
          <UpdateBoardSlugForm
            boardPublicId={boardId ?? ""}
            workspaceSlug={workspace.slug ?? ""}
            boardSlug={boardData?.slug ?? ""}
            queryParams={queryParams}
          />
        </Modal>

        <Modal
          modalSize="sm"
          isVisible={isOpen && modalContentType === "MOVE_BOARD"}
        >
          <MoveBoardForm boardPublicId={boardId ?? ""} />
        </Modal>

        <Modal
          modalSize="sm"
          isVisible={isOpen && modalContentType === "CREATE_TEMPLATE"}
        >
          <NewTemplateForm
            workspacePublicId={workspace.publicId}
            sourceBoardPublicId={boardId ?? ""}
            sourceBoardName={boardData?.name ?? ""}
          />
        </Modal>

        <Modal
          modalSize="sm"
          isVisible={isOpen && modalContentType === "EDIT_YOUTUBE"}
        >
          <EditYouTubeModal />
        </Modal>

        <Modal
          modalSize="sm"
          isVisible={isOpen && modalContentType === "CARD_CONTEXT_MEMBERS"}
        >
          <CardContextMembersModal />
        </Modal>
        <Modal
          modalSize="sm"
          isVisible={isOpen && modalContentType === "CARD_CONTEXT_MOVE_LIST"}
        >
          <CardContextMoveListModal />
        </Modal>
        <Modal
          modalSize="sm"
          isVisible={isOpen && modalContentType === "CARD_CONTEXT_MOVE_BOARD"}
        >
          <CardContextMoveBoardModal />
        </Modal>
        <Modal
          modalSize="sm"
          isVisible={
            isOpen && modalContentType === "CARD_CONTEXT_MOVE_MANY_BOARD"
          }
        >
          <CardContextMoveManyBoardModal
            cardPublicIds={orderedSelectedCardPublicIds}
            currentBoardPublicId={boardId ?? ""}
            workspacePublicId={workspace.publicId}
            hasLabels={selectedCardsHaveLabels}
            openSubtaskCount={selectedOpenSubtaskCount}
            resourceCount={selectedResourceCount}
            currentBoardIsPublic={boardData?.visibility === "public"}
            onMoved={cancelCardSelection}
          />
        </Modal>
        <Modal
          modalSize="sm"
          isVisible={isOpen && modalContentType === "CARD_CONTEXT_LABELS"}
        >
          <CardContextLabelsModal />
        </Modal>
        <Modal
          modalSize="sm"
          isVisible={isOpen && modalContentType === "CARD_CONTEXT_DUE_DATE"}
        >
          <CardContextDueDateModal />
        </Modal>
        <CardContextAppearanceModal />
        <Modal
          modalSize="md"
          isVisible={isOpen && modalContentType === "CARD_CONTEXT_DUPLICATE"}
        >
          <CardContextDuplicateModal
            boardPublicId={boardId ?? ""}
            isTemplate={!!isTemplate}
          />
        </Modal>
        <Modal
          modalSize="sm"
          isVisible={isOpen && modalContentType === "DELETE_CARD"}
        >
          <DeleteCardConfirmation
            cardPublicId={entityId}
            boardPublicId={boardId ?? ""}
          />
        </Modal>
      </>
    );
  };

  return (
    <>
      <PageHead
        title={`${boardData?.name ?? (isTemplate ? t`Board` : t`Template`)} | ${workspace.name}`}
      />
      <div className="relative flex h-full flex-col">
        <PatternedBackground />
        <div className="z-10 flex w-full flex-col justify-between p-6 md:flex-row md:p-8">
          {isLoading && !boardData && (
            <div className="flex space-x-2">
              <div className="h-[2.3rem] w-[150px] animate-pulse rounded-[5px] bg-light-200 dark:bg-dark-100" />
            </div>
          )}
          {boardData && (
            <form
              onSubmit={handleSubmit(onSubmit)}
              className="order-2 focus-visible:outline-none md:order-1"
            >
              <input
                id="name"
                type="text"
                {...register("name")}
                onBlur={canEditBoard ? handleSubmit(onSubmit) : undefined}
                readOnly={!canEditBoard}
                className="block border-0 bg-transparent p-0 py-0 font-bold leading-[2.3rem] tracking-tight text-neutral-900 focus:ring-0 focus-visible:outline-none disabled:cursor-not-allowed dark:text-dark-1000 sm:text-[1.2rem]"
              />
            </form>
          )}
          {!boardData && !isLoading && (
            <p className="order-2 block p-0 py-0 font-bold leading-[2.3rem] tracking-tight text-neutral-900 dark:text-dark-1000 sm:text-[1.2rem] md:order-1">
              {t`${isTemplate ? "Template" : "Board"} not found`}
            </p>
          )}
          <BoardHeaderActions
            isTemplate={!!isTemplate}
            isSelectingCards={isSelectingCards}
            isLoading={isLoading}
            boardId={boardId ?? ""}
            boardData={boardData}
            workspaceSlug={workspace.slug ?? ""}
            workspaceRole={workspace.role}
            canEditBoard={!!canEditBoard}
            canEditCard={!!canEditCard}
            canCreateList={!!canCreateList}
            queryParams={queryParams}
            createListShortcutTooltipContent={createListShortcutTooltipContent}
            onOpenUpdateSlug={() => openModal("UPDATE_BOARD_SLUG")}
            onToggleCardSelection={toggleCardSelectionMode}
            onCreateList={() => {
              if (boardId && canCreateList) openNewListForm(boardId);
            }}
          />
        </div>

        <div
          ref={scrollRef}
          onMouseDown={onMouseDown}
          className={`scrollbar-w-none scrollbar-track-rounded-[4px] scrollbar-thumb-rounded-[4px] scrollbar-h-[8px] z-0 flex-1 snap-x snap-mandatory scroll-pl-[10px] overflow-y-hidden overflow-x-scroll overscroll-contain scrollbar scrollbar-track-light-200 scrollbar-thumb-light-400 dark:scrollbar-track-dark-100 dark:scrollbar-thumb-dark-300 md:snap-none`}
        >
          {isLoading ? (
            <div className="ml-[2rem] flex">
              <div className="0 mr-5 h-[500px] w-[18rem] animate-pulse rounded-md bg-light-200 dark:bg-dark-100" />
              <div className="0 mr-5 h-[275px] w-[18rem] animate-pulse rounded-md bg-light-200 dark:bg-dark-100" />
              <div className="0 mr-5 h-[375px] w-[18rem] animate-pulse rounded-md bg-light-200 dark:bg-dark-100" />
            </div>
          ) : boardData ? (
            <>
              {boardData.lists.length === 0 ? (
                <div className="z-10 flex h-full w-full flex-col items-center justify-center space-y-8 pb-[150px]">
                  <div className="flex flex-col items-center">
                    <HiOutlineSquare3Stack3D className="h-10 w-10 text-light-800 dark:text-dark-800" />
                    <p className="mb-2 mt-4 text-[14px] font-bold text-light-1000 dark:text-dark-950">
                      {t`No lists`}
                    </p>
                    <p className="text-[14px] text-light-900 dark:text-dark-900">
                      {canCreateList
                        ? t`Get started by creating a new list`
                        : t`No lists have been created yet`}
                    </p>
                  </div>
                  <Tooltip
                    content={
                      !canCreateList ? t`You don't have permission` : undefined
                    }
                  >
                    <Button
                      onClick={() => {
                        if (boardId && canCreateList) openNewListForm(boardId);
                      }}
                      disabled={!canCreateList}
                    >
                      {t`Create new list`}
                    </Button>
                  </Tooltip>
                </div>
              ) : (
                <DragDropContext onDragEnd={onDragEnd}>
                  <Droppable
                    droppableId="all-lists"
                    direction="horizontal"
                    type="LIST"
                  >
                    {(provided) => (
                      <div
                        className="flex w-max"
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                      >
                        <div className="min-w-[10px] md:min-w-[2rem]" />
                        {boardData.lists.map((list, index) => (
                          <List
                            index={index}
                            key={list.publicId}
                            list={list}
                            isSelectionMode={isSelectingCards}
                            setSelectedPublicListId={(publicListId) =>
                              setSelectedPublicListId(publicListId)
                            }
                          >
                            <Droppable
                              droppableId={`${list.publicId}`}
                              type="CARD"
                            >
                              {(provided) => (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.droppableProps}
                                  className="scrollbar-track-rounded-[4px] scrollbar-thumb-rounded-[4px] scrollbar-w-[8px] z-10 h-full max-h-[calc(100vh-225px)] min-h-[2rem] overflow-y-auto pr-1 scrollbar dark:scrollbar-track-dark-100 dark:scrollbar-thumb-dark-600"
                                >
                                  {list.cards.map((card, index) => (
                                    <BoardCard
                                      key={card.publicId}
                                      card={card}
                                      index={index}
                                      boardPublicId={boardId ?? ""}
                                      cardPrefix={
                                        boardData.workspace.cardPrefix
                                      }
                                      isTemplate={!!isTemplate}
                                      canEdit={!!canEditCard}
                                      isSelectionMode={isSelectingCards}
                                      isSelected={selectedCardPublicIdSet.has(
                                        card.publicId,
                                      )}
                                      onToggle={toggleCardSelection}
                                      onOpenContextMenu={(
                                        cardPublicId,
                                        position,
                                      ) =>
                                        setContextMenu({
                                          ...position,
                                          cardPublicId,
                                        })
                                      }
                                    />
                                  ))}
                                  {provided.placeholder}
                                </div>
                              )}
                            </Droppable>
                          </List>
                        ))}
                        <div className="min-w-[calc(100vw-18rem)] md:min-w-[0.75rem]" />
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </DragDropContext>
              )}
            </>
          ) : null}
        </div>
        {isSelectingCards && (
          <CardSelectionToolbar
            selectedCount={orderedSelectedCardPublicIds.length}
            onCancel={cancelCardSelection}
            onMove={openMoveSelectedCardsModal}
          />
        )}
        {contextMenu && (
          <CardContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            onAction={handleCardContextMenuAction}
            canEdit={!!canEditCard}
            canMoveToBoard={!isTemplate}
            canSetDueDate={!isTemplate}
          />
        )}
        <OpenSubtasksConfirmationDialog
          isOpen={pendingCardMove !== null}
          openCount={pendingCardMove?.openCount ?? 0}
          isLoading={updateCardMutation.isPending}
          onCancel={() => setPendingCardMove(null)}
          onConfirm={() => {
            if (!pendingCardMove) return;
            const move = pendingCardMove;
            setPendingCardMove(null);
            updateCardMutation.mutate({
              cardPublicId: move.cardPublicId,
              listPublicId: move.listPublicId,
              index: move.index,
              confirmOpenSubtasks: true,
            });
          }}
        />
        {renderModalContent()}
      </div>
    </>
  );
}
