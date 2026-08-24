import type { KeyboardEvent } from "react";
import type { DropResult } from "react-beautiful-dnd";
import { useRouter } from "next/router";
import { t } from "@lingui/core/macro";
import { useEffect, useMemo, useRef, useState } from "react";
import { DragDropContext, Draggable } from "react-beautiful-dnd";
import {
  HiArrowPath,
  HiOutlineCloud,
  HiOutlineExclamationTriangle,
} from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

import type {
  CardPipelineData,
  CardPipelineStage,
  WorkspaceMemberOption,
} from "./subtask-types";
import { StrictModeDroppable as Droppable } from "~/components/StrictModeDroppable";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import {
  getCardWorkspaceNavigationQuery,
  getNextTabIndex,
} from "~/utils/card-workspace";
import { DevelopmentProgress } from "./DevelopmentProgress";
import { PipelineStageColumn } from "./PipelineStageColumn";
import { SubtaskEditorDialog } from "./SubtaskEditorDialog";

interface CardSubtasksViewProps {
  cardPublicId: string;
  members: WorkspaceMemberOption[];
  canEdit: boolean;
  embedded?: boolean;
  enabled?: boolean;
  initializationRequested?: boolean;
  onRequestInitialization?: () => void;
  singleStageLayout?: boolean;
}

type CardSubtasksViewContentProps = Omit<CardSubtasksViewProps, "enabled">;

interface PipelineInitializationState {
  canEdit: boolean;
  initializationRequested: boolean;
  isOnline: boolean;
  browserIsOnline: boolean;
  hasPipeline: boolean;
  pipelineInitialized: boolean;
  didInitializationFail: boolean;
  initializationStarted: boolean;
  initializationPending: boolean;
}

export const shouldInitializeCardPipeline = ({
  canEdit,
  initializationRequested,
  isOnline,
  browserIsOnline,
  hasPipeline,
  pipelineInitialized,
  didInitializationFail,
  initializationStarted,
  initializationPending,
}: PipelineInitializationState) =>
  canEdit &&
  initializationRequested &&
  isOnline &&
  browserIsOnline &&
  hasPipeline &&
  !pipelineInitialized &&
  !didInitializationFail &&
  !initializationStarted &&
  !initializationPending;

const cloneStages = (stages: CardPipelineStage[]) =>
  stages.map((stage) => ({
    ...stage,
    subtasks: stage.subtasks.map((subtask) => ({ ...subtask })),
  }));

export function CardSubtasksView({
  enabled = true,
  ...props
}: CardSubtasksViewProps) {
  if (!enabled) return null;
  return <CardSubtasksViewContent {...props} />;
}

function CardSubtasksViewContent({
  cardPublicId,
  members,
  canEdit,
  embedded = false,
  initializationRequested = true,
  onRequestInitialization,
  singleStageLayout = false,
}: CardSubtasksViewContentProps) {
  const router = useRouter();
  const utils = api.useUtils();
  const { showPopup } = usePopup();
  const initializedRef = useRef(false);
  const [stages, setStages] = useState<CardPipelineStage[]>([]);
  const [activeMobileStageId, setActiveMobileStageId] = useState<string | null>(
    null,
  );
  const [creatingStageId, setCreatingStageId] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [didInitializationFail, setDidInitializationFail] = useState(false);
  const [titleResetVersion, setTitleResetVersion] = useState(0);
  const [descriptionResetVersion, setDescriptionResetVersion] = useState(0);
  const [checklistResetVersion, setChecklistResetVersion] = useState(0);

  const pipelineQuery = api.cardPipeline.get.useQuery(
    { cardPublicId },
    { enabled: cardPublicId.length >= 12, retry: 1 },
  );
  const pipeline: CardPipelineData | undefined = pipelineQuery.data;

  const refresh = async () => {
    await Promise.all([
      utils.cardPipeline.get.invalidate({ cardPublicId }),
      utils.card.byId.invalidate({ cardPublicId }),
      utils.board.byId.invalidate(),
    ]);
  };

  const mutationError = (
    header: string,
    options: {
      resetTitle?: boolean;
      resetDescription?: boolean;
      resetChecklist?: boolean;
    } = {},
  ) => {
    setStages(pipeline?.stages ?? []);
    if (options.resetTitle) {
      setTitleResetVersion((current) => current + 1);
    }
    if (options.resetDescription) {
      setDescriptionResetVersion((current) => current + 1);
    }
    if (options.resetChecklist) {
      setChecklistResetVersion((current) => current + 1);
    }
    showPopup({
      header,
      message: t`Please try again. Your previous data is still safe.`,
      icon: "error",
    });
    void pipelineQuery.refetch();
  };

  const initialize = api.cardPipeline.initialize.useMutation({
    onSuccess: (data) => {
      setDidInitializationFail(false);
      setStages(data.stages);
      void refresh();
    },
    onError: () => {
      initializedRef.current = false;
      setDidInitializationFail(true);
    },
  });
  const updateStages = api.cardPipeline.updateStages.useMutation({
    onSuccess: () => void refresh(),
    onError: () => mutationError(t`Unable to update pipeline stages`),
  });
  const createSubtask = api.cardSubtask.create.useMutation({
    onSuccess: () => {
      setCreatingStageId(null);
      void refresh();
    },
    onError: () => mutationError(t`Unable to create subtask`),
  });
  const updateSubtask = api.cardSubtask.update.useMutation({
    onSuccess: () => void refresh(),
    onError: (_error, input) =>
      mutationError(t`Unable to update subtask`, {
        resetTitle: input.title !== undefined,
        resetDescription: input.description !== undefined,
      }),
  });
  const moveSubtask = api.cardSubtask.move.useMutation({
    onSuccess: () => void refresh(),
    onError: () => mutationError(t`Unable to move subtask`),
  });
  const reorderSubtask = api.cardSubtask.reorder.useMutation({
    onSuccess: () => void refresh(),
    onError: () => mutationError(t`Unable to reorder subtask`),
  });
  const deleteSubtask = api.cardSubtask.delete.useMutation({
    onSuccess: () => {
      closeSubtask();
      void refresh();
    },
    onError: () => mutationError(t`Unable to delete subtask`),
  });
  const setOwner = api.cardSubtask.setOwner.useMutation({
    onSuccess: () => void refresh(),
    onError: () => mutationError(t`Unable to assign subtask`),
  });
  const createChecklistItem = api.cardSubtask.createChecklistItem.useMutation({
    onSuccess: () => void refresh(),
    onError: () => mutationError(t`Unable to create checklist item`),
  });
  const updateChecklistItem = api.cardSubtask.updateChecklistItem.useMutation({
    onSuccess: () => void refresh(),
    onError: (_error, input) =>
      mutationError(t`Unable to update checklist item`, {
        resetChecklist: input.title !== undefined,
      }),
  });
  const deleteChecklistItem = api.cardSubtask.deleteChecklistItem.useMutation({
    onSuccess: () => void refresh(),
    onError: () => mutationError(t`Unable to delete checklist item`),
  });

  useEffect(() => {
    if (!pipeline) return;
    setStages(pipeline.stages);
    setActiveMobileStageId(
      (current) => current ?? pipeline.stages[0]?.publicId ?? null,
    );
  }, [pipeline]);

  useEffect(() => {
    const shouldInitialize = shouldInitializeCardPipeline({
      canEdit,
      initializationRequested,
      isOnline,
      browserIsOnline:
        typeof navigator === "undefined" ? true : navigator.onLine,
      hasPipeline: pipeline !== undefined,
      pipelineInitialized: pipeline?.initialized ?? false,
      didInitializationFail,
      initializationStarted: initializedRef.current,
      initializationPending: initialize.isPending,
    });
    if (!shouldInitialize) {
      return;
    }

    initializedRef.current = true;
    initialize.mutate({ cardPublicId });
  }, [
    canEdit,
    cardPublicId,
    didInitializationFail,
    initialize,
    initializationRequested,
    isOnline,
    pipeline,
  ]);

  useEffect(() => {
    const updateOnlineState = () => setIsOnline(navigator.onLine);
    updateOnlineState();
    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);
    return () => {
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("offline", updateOnlineState);
    };
  }, []);

  const selectedSubtaskPublicId = Array.isArray(router.query.subtask)
    ? router.query.subtask[0]
    : router.query.subtask;
  const selectedSubtask = useMemo(
    () =>
      stages
        .flatMap((stage) => stage.subtasks)
        .find((subtask) => subtask.publicId === selectedSubtaskPublicId) ??
      null,
    [selectedSubtaskPublicId, stages],
  );

  useEffect(() => {
    if (!selectedSubtask) return;
    setActiveMobileStageId(selectedSubtask.stagePublicId);
  }, [selectedSubtask]);

  const openSubtask = async (subtaskPublicId: string) => {
    const nextQuery = getCardWorkspaceNavigationQuery(
      router.query,
      "subtasks",
      { subtask: subtaskPublicId },
    );
    await router.replace(
      {
        pathname: router.pathname,
        query: nextQuery,
      },
      undefined,
      { shallow: true },
    );
  };

  const openCanvasFrame = async (framePublicId: string) => {
    const nextQuery = getCardWorkspaceNavigationQuery(
      router.query,
      "whiteboard",
      { frame: framePublicId },
    );
    await router.replace(
      {
        pathname: router.pathname,
        query: nextQuery,
      },
      undefined,
      { shallow: true },
    );
  };

  const selectMobileStage = (stagePublicId: string) => {
    setActiveMobileStageId(stagePublicId);
  };

  const handleStageTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    const nextIndex = getNextTabIndex(currentIndex, stages.length, event.key);
    if (nextIndex === null) return;

    const nextStage = stages[nextIndex];
    if (!nextStage) return;
    event.preventDefault();
    const nextElement =
      event.currentTarget.parentElement?.querySelectorAll('[role="tab"]')[
        nextIndex
      ];
    if (nextElement instanceof HTMLElement) nextElement.focus();
    setActiveMobileStageId(nextStage.publicId);
  };

  const closeSubtask = () => {
    const nextQuery = getCardWorkspaceNavigationQuery(router.query, "subtasks");
    void router.replace(
      { pathname: router.pathname, query: nextQuery },
      undefined,
      { shallow: true },
    );
  };

  const openResource = (resourcePublicId: string) => {
    const nextQuery = getCardWorkspaceNavigationQuery(router.query, "files", {
      resource: resourcePublicId,
    });
    void router.replace(
      { pathname: router.pathname, query: nextQuery },
      undefined,
      { shallow: true },
    );
  };

  const reorderStages = (sourceIndex: number, destinationIndex: number) => {
    if (!canEdit || !isOnline || sourceIndex === destinationIndex) return;
    const nextStages = [...stages];
    const [movedStage] = nextStages.splice(sourceIndex, 1);
    if (!movedStage) return;
    nextStages.splice(destinationIndex, 0, movedStage);
    const normalized = nextStages.map((stage, index) => ({ ...stage, index }));
    setStages(normalized);
    updateStages.mutate({
      cardPublicId,
      stages: normalized.map((stage) => ({
        stagePublicId: stage.publicId,
        index: stage.index,
      })),
    });
  };

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination || !canEdit || !isOnline) return;

    if (result.type === "PIPELINE_STAGE") {
      reorderStages(result.source.index, result.destination.index);
      return;
    }

    if (result.type !== "SUBTASK") return;
    const sourceStageIndex = stages.findIndex(
      (stage) => stage.publicId === result.source.droppableId,
    );
    const destinationStageIndex = stages.findIndex(
      (stage) => stage.publicId === result.destination?.droppableId,
    );
    if (sourceStageIndex < 0 || destinationStageIndex < 0) return;

    const nextStages = cloneStages(stages);
    const sourceStage = nextStages[sourceStageIndex];
    const destinationStage = nextStages[destinationStageIndex];
    if (!sourceStage || !destinationStage) return;
    const [movedSubtask] = sourceStage.subtasks.splice(result.source.index, 1);
    if (!movedSubtask) return;
    const nextSubtask = {
      ...movedSubtask,
      stagePublicId: destinationStage.publicId,
    };
    destinationStage.subtasks.splice(result.destination.index, 0, nextSubtask);
    sourceStage.subtasks = sourceStage.subtasks.map((subtask, index) => ({
      ...subtask,
      index,
    }));
    destinationStage.subtasks = destinationStage.subtasks.map(
      (subtask, index) => ({ ...subtask, index }),
    );
    setStages(nextStages);

    if (sourceStage.publicId === destinationStage.publicId) {
      reorderSubtask.mutate({
        cardPublicId,
        stagePublicId: destinationStage.publicId,
        orderedSubtaskPublicIds: destinationStage.subtasks.map(
          (subtask) => subtask.publicId,
        ),
      });
    } else {
      moveSubtask.mutate({
        subtaskPublicId: movedSubtask.publicId,
        stagePublicId: destinationStage.publicId,
        index: result.destination.index,
      });
    }
  };

  const updateStage = (input: {
    stagePublicId: string;
    name?: string;
    colourCode?: string | null;
  }) => {
    setStages((current) =>
      current.map((stage) =>
        stage.publicId === input.stagePublicId ? { ...stage, ...input } : stage,
      ),
    );
    updateStages.mutate({ cardPublicId, stages: [input] });
  };

  const isSaving = [
    updateStages,
    createSubtask,
    updateSubtask,
    moveSubtask,
    reorderSubtask,
    deleteSubtask,
    setOwner,
    createChecklistItem,
    updateChecklistItem,
    deleteChecklistItem,
  ].some((mutation) => mutation.isPending);

  const displayedStages = singleStageLayout
    ? stages.filter((stage) => stage.publicId === activeMobileStageId)
    : stages;
  const tabPanelProps = embedded
    ? {}
    : {
        id: "card-view-subtasks",
        role: "tabpanel" as const,
        "aria-labelledby": "card-tab-subtasks",
      };

  if (pipelineQuery.isLoading || initialize.isPending) {
    return (
      <section {...tabPanelProps} className="p-4 md:p-6">
        <div className="mb-5 h-20 animate-pulse rounded-md bg-light-200 dark:bg-dark-200" />
        <div
          className={twMerge(
            "grid grid-cols-1 gap-3",
            !singleStageLayout &&
              "min-[1400px]:auto-cols-[minmax(16rem,1fr)] min-[1400px]:grid-flow-col min-[1400px]:grid-cols-none min-[1400px]:overflow-x-auto",
          )}
        >
          {(singleStageLayout ? [0] : [0, 1, 2, 3]).map((item) => (
            <div
              key={item}
              className="h-80 animate-pulse rounded-md bg-light-200 dark:bg-dark-200"
            />
          ))}
        </div>
      </section>
    );
  }

  if (pipelineQuery.isError) {
    return (
      <section
        {...tabPanelProps}
        className="flex min-h-[28rem] items-center justify-center p-6"
      >
        <div className="max-w-sm text-center">
          <HiOutlineExclamationTriangle className="mx-auto h-7 w-7 text-red-600 dark:text-red-400" />
          <h2 className="mt-3 text-sm font-semibold text-light-1000 dark:text-dark-1000">
            {t`Subtasks could not be loaded`}
          </h2>
          <p className="mt-1 text-xs leading-5 text-light-700 dark:text-dark-700">
            {t`Your card is safe. Check your connection and try again.`}
          </p>
          <button
            type="button"
            onClick={() => void pipelineQuery.refetch()}
            className="mt-4 inline-flex items-center gap-2 rounded-md border border-light-500 px-3 py-2 text-xs font-medium text-light-950 hover:bg-light-200 dark:border-dark-500 dark:text-dark-950 dark:hover:bg-dark-200"
          >
            <HiArrowPath className="h-4 w-4" />
            {t`Try again`}
          </button>
        </div>
      </section>
    );
  }

  if (!pipeline?.initialized && canEdit && didInitializationFail) {
    return (
      <section
        {...tabPanelProps}
        className="flex min-h-[28rem] items-center justify-center p-6"
      >
        <div className="max-w-sm text-center">
          <HiOutlineExclamationTriangle className="mx-auto h-7 w-7 text-amber-600 dark:text-amber-400" />
          <h2 className="mt-3 text-sm font-semibold text-light-1000 dark:text-dark-1000">
            {t`The subtask pipeline could not be started`}
          </h2>
          <p className="mt-1 text-xs leading-5 text-light-700 dark:text-dark-700">
            {t`No stages were created. Check your connection and try again.`}
          </p>
          <button
            type="button"
            onClick={() => {
              setDidInitializationFail(false);
              initializedRef.current = true;
              initialize.mutate({ cardPublicId });
            }}
            className="mt-4 inline-flex items-center gap-2 rounded-md border border-light-500 px-3 py-2 text-xs font-medium text-light-950 hover:bg-light-200 dark:border-dark-500 dark:text-dark-950 dark:hover:bg-dark-200"
          >
            <HiArrowPath className="h-4 w-4" />
            {t`Try again`}
          </button>
        </div>
      </section>
    );
  }

  if (!pipeline?.initialized && canEdit && !initializationRequested) {
    return (
      <section
        {...tabPanelProps}
        className="flex min-h-64 items-center justify-center p-6"
      >
        <div className="max-w-sm text-center">
          <p className="text-sm font-medium text-light-1000 dark:text-dark-1000">
            {t`This card does not have a subtask pipeline yet`}
          </p>
          <p className="mt-2 text-xs leading-5 text-light-700 dark:text-dark-700">
            {t`Activate the pipeline when you are ready to break down the work.`}
          </p>
          <button
            type="button"
            onClick={onRequestInitialization}
            className="mt-4 inline-flex items-center rounded-md border border-light-500 px-3 py-2 text-xs font-medium text-light-950 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:border-dark-500 dark:text-dark-950 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
          >
            {t`Activate subtasks`}
          </button>
        </div>
      </section>
    );
  }

  if (!pipeline?.initialized && !canEdit) {
    return (
      <section
        {...tabPanelProps}
        className="flex min-h-[28rem] items-center justify-center p-6"
      >
        <div className="max-w-sm text-center">
          <p className="text-sm font-medium text-light-1000 dark:text-dark-1000">
            {t`This card does not have a subtask pipeline yet`}
          </p>
          <p className="mt-2 text-xs leading-5 text-light-700 dark:text-dark-700">
            {t`It will appear here when an editor starts planning the work.`}
          </p>
        </div>
      </section>
    );
  }

  const summary = pipeline?.summary ?? {
    total: 0,
    completed: 0,
    blocked: 0,
    progressPercent: 0,
  };

  return (
    <section
      {...tabPanelProps}
      className={twMerge(
        "flex min-h-0 flex-col p-3 md:p-5",
        !embedded && "h-full",
      )}
    >
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        {!embedded && (
          <div className="max-w-xl flex-1">
            <DevelopmentProgress summary={summary} interactive={false} />
          </div>
        )}
        <div className="flex items-center gap-2 text-[11px] text-light-700 dark:text-dark-700">
          {!isOnline && (
            <span className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
              <HiOutlineCloud className="h-4 w-4" />
              {t`Offline — changes are paused`}
            </span>
          )}
          {isOnline && pipelineQuery.isFetching && <span>{t`Updating…`}</span>}
        </div>
      </div>

      <div
        className={twMerge(
          "mb-3 grid grid-cols-4 gap-1",
          !singleStageLayout && "min-[1400px]:hidden",
        )}
        role="tablist"
        aria-label={t`Pipeline stages`}
      >
        {stages.map((stage, index) => (
          <button
            key={stage.publicId}
            id={`pipeline-stage-tab-${stage.publicId}`}
            type="button"
            role="tab"
            aria-selected={activeMobileStageId === stage.publicId}
            aria-controls={`pipeline-stage-panel-${stage.publicId}`}
            tabIndex={activeMobileStageId === stage.publicId ? 0 : -1}
            onClick={() => selectMobileStage(stage.publicId)}
            onKeyDown={(event) => handleStageTabKeyDown(event, index)}
            className={twMerge(
              "min-w-0 rounded-md px-1.5 py-2 text-[10px] font-medium text-light-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:text-dark-700 dark:focus-visible:ring-dark-800",
              activeMobileStageId === stage.publicId &&
                "bg-light-200 text-light-1000 dark:bg-dark-200 dark:text-dark-1000",
            )}
          >
            <span className="block truncate">{stage.name}</span>
            <span className="mt-0.5 block tabular-nums">
              {stage.subtasks.length}
            </span>
          </button>
        ))}
      </div>

      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable
          droppableId="pipeline-stages"
          direction="horizontal"
          type="PIPELINE_STAGE"
        >
          {(provided) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className={twMerge(
                "grid min-h-0 flex-1 grid-cols-1 gap-3",
                !singleStageLayout &&
                  "min-[1400px]:auto-cols-[minmax(16rem,1fr)] min-[1400px]:grid-flow-col min-[1400px]:grid-cols-none min-[1400px]:overflow-x-auto min-[1400px]:pb-2",
              )}
            >
              {displayedStages.map((stage, displayIndex) => {
                const stageIndex = stages.findIndex(
                  (candidate) => candidate.publicId === stage.publicId,
                );
                return (
                  <Draggable
                    key={stage.publicId}
                    draggableId={stage.publicId}
                    index={displayIndex}
                    isDragDisabled={!canEdit || !isOnline}
                  >
                    {(stageProvided) => (
                      <PipelineStageColumn
                        stage={stage}
                        provided={stageProvided}
                        canEdit={canEdit && isOnline}
                        isMobileActive={activeMobileStageId === stage.publicId}
                        isCreating={creatingStageId === stage.publicId}
                        isSubmitting={createSubtask.isPending}
                        onBeginCreate={() => setCreatingStageId(stage.publicId)}
                        onCancelCreate={() => setCreatingStageId(null)}
                        onCreate={async (title) => {
                          await createSubtask.mutateAsync({
                            cardPublicId,
                            stagePublicId: stage.publicId,
                            title,
                          });
                        }}
                        onOpenSubtask={(subtaskPublicId) =>
                          void openSubtask(subtaskPublicId)
                        }
                        canMoveLeft={stageIndex > 0}
                        canMoveRight={stageIndex < stages.length - 1}
                        onMoveStage={(direction) =>
                          reorderStages(
                            stageIndex,
                            direction === "left"
                              ? stageIndex - 1
                              : stageIndex + 1,
                          )
                        }
                        onUpdateStage={updateStage}
                      />
                    )}
                  </Draggable>
                );
              })}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

      <SubtaskEditorDialog
        key={selectedSubtask?.publicId ?? "closed"}
        cardPublicId={cardPublicId}
        subtask={selectedSubtask}
        stages={stages}
        members={members}
        canEdit={canEdit && isOnline}
        isSaving={isSaving}
        titleResetVersion={titleResetVersion}
        descriptionResetVersion={descriptionResetVersion}
        checklistResetVersion={checklistResetVersion}
        onClose={closeSubtask}
        onUpdate={(input) => {
          if (!selectedSubtask) return;
          updateSubtask.mutate({
            subtaskPublicId: selectedSubtask.publicId,
            ...input,
          });
        }}
        onMove={(stagePublicId) => {
          if (!selectedSubtask) return;
          moveSubtask.mutate({
            subtaskPublicId: selectedSubtask.publicId,
            stagePublicId,
          });
        }}
        onSetOwner={(ownerPublicId) => {
          if (!selectedSubtask) return;
          setOwner.mutate({
            subtaskPublicId: selectedSubtask.publicId,
            ownerPublicId,
          });
        }}
        onCreateChecklistItem={async (title) => {
          if (!selectedSubtask) return;
          await createChecklistItem.mutateAsync({
            subtaskPublicId: selectedSubtask.publicId,
            title,
          });
        }}
        onUpdateChecklistItem={(checklistItemPublicId, input) =>
          updateChecklistItem.mutate({ checklistItemPublicId, ...input })
        }
        onDeleteChecklistItem={(checklistItemPublicId) =>
          deleteChecklistItem.mutate({ checklistItemPublicId })
        }
        onOpenResource={openResource}
        onOpenCanvasFrame={(framePublicId) =>
          void openCanvasFrame(framePublicId)
        }
        onDelete={() => {
          if (!selectedSubtask) return;
          deleteSubtask.mutate({
            subtaskPublicId: selectedSubtask.publicId,
          });
        }}
      />
    </section>
  );
}
