import type { DraggableProvided } from "react-beautiful-dnd";
import { t } from "@lingui/core/macro";
import { useEffect, useState } from "react";
import { Draggable } from "react-beautiful-dnd";
import {
  HiBars2,
  HiChevronLeft,
  HiChevronRight,
  HiOutlineCheckCircle,
  HiOutlineExclamationCircle,
  HiOutlinePauseCircle,
  HiOutlinePlayCircle,
  HiPlusSmall,
  HiXMark,
} from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

import type { CardPipelineStage } from "./subtask-types";
import AccentColourSelector from "~/components/AccentColourSelector";
import { StrictModeDroppable as Droppable } from "~/components/StrictModeDroppable";
import { SubtaskCard } from "./SubtaskCard";

interface PipelineStageColumnProps {
  stage: CardPipelineStage;
  provided: DraggableProvided;
  canEdit: boolean;
  isMobileActive: boolean;
  isCreating: boolean;
  isSubmitting: boolean;
  onBeginCreate: () => void;
  onCancelCreate: () => void;
  onCreate: (title: string) => Promise<void>;
  onOpenSubtask: (subtaskPublicId: string) => void;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onMoveStage: (direction: "left" | "right") => void;
  onUpdateStage: (input: {
    stagePublicId: string;
    name?: string;
    colourCode?: string | null;
  }) => void;
}

const statusPresentation = (status: CardPipelineStage["status"]) => {
  switch (status) {
    case "inProgress":
      return { label: t`In progress`, icon: HiOutlinePlayCircle };
    case "blocked":
      return { label: t`Blocked`, icon: HiOutlineExclamationCircle };
    case "done":
      return { label: t`Done`, icon: HiOutlineCheckCircle };
    default:
      return { label: t`Planned`, icon: HiOutlinePauseCircle };
  }
};

export function PipelineStageColumn({
  stage,
  provided,
  canEdit,
  isMobileActive,
  isCreating,
  isSubmitting,
  onBeginCreate,
  onCancelCreate,
  onCreate,
  onOpenSubtask,
  canMoveLeft,
  canMoveRight,
  onMoveStage,
  onUpdateStage,
}: PipelineStageColumnProps) {
  const [name, setName] = useState(stage.name);
  const [newTitle, setNewTitle] = useState("");
  const presentation = statusPresentation(stage.status);
  const StatusIcon = presentation.icon;

  useEffect(() => setName(stage.name), [stage.name]);

  const submitName = () => {
    if (!canEdit) {
      setName(stage.name);
      return;
    }
    const nextName = name.trim();
    if (!nextName) {
      setName(stage.name);
      return;
    }
    if (nextName !== stage.name) {
      onUpdateStage({ stagePublicId: stage.publicId, name: nextName });
    }
  };

  const submitSubtask = async () => {
    if (!canEdit) return;
    const title = newTitle.trim();
    if (!title) return;
    try {
      await onCreate(title);
      setNewTitle("");
    } catch {
      return;
    }
  };

  return (
    <section
      id={`pipeline-stage-panel-${stage.publicId}`}
      ref={provided.innerRef}
      {...provided.draggableProps}
      role="tabpanel"
      aria-labelledby={`pipeline-stage-tab-${stage.publicId}`}
      aria-label={stage.name}
      tabIndex={-1}
      className={twMerge(
        "relative hidden min-h-[24rem] min-w-0 flex-1 flex-col rounded-md border border-light-300 bg-light-100 dark:border-dark-400 dark:bg-dark-50 min-[1400px]:flex",
        isMobileActive && "flex w-full",
      )}
    >
      {stage.colourCode && (
        <span
          className="absolute inset-x-0 top-0 h-1 rounded-t-md"
          style={{ backgroundColor: stage.colourCode }}
          aria-hidden="true"
        />
      )}
      <div className="border-b border-light-300 px-3 pb-3 pt-3.5 dark:border-dark-400">
        <div className="flex items-center gap-2">
          <button
            type="button"
            {...provided.dragHandleProps}
            disabled={!canEdit}
            className="hidden h-7 w-5 shrink-0 cursor-grab items-center justify-center rounded text-light-600 hover:bg-light-200 hover:text-light-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 active:cursor-grabbing disabled:cursor-default disabled:opacity-40 dark:text-dark-600 dark:hover:bg-dark-200 dark:hover:text-dark-900 dark:focus-visible:ring-dark-800 min-[1400px]:flex"
            aria-label={t`Reorder ${stage.name}`}
          >
            <HiBars2 className="h-4 w-4" />
          </button>
          <StatusIcon
            className="h-4 w-4 shrink-0 text-light-700 dark:text-dark-700"
            aria-label={presentation.label}
          />
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={submitName}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setName(stage.name);
                event.currentTarget.blur();
              }
            }}
            readOnly={!canEdit}
            maxLength={255}
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm font-semibold text-light-1000 focus:ring-0 focus-visible:outline-none dark:text-dark-1000"
            aria-label={t`Stage name`}
          />
          <span className="text-xs tabular-nums text-light-700 dark:text-dark-700">
            {stage.subtasks.length}
          </span>
          {canEdit && (
            <div className="flex items-center min-[1400px]:hidden">
              <button
                type="button"
                onClick={() => onMoveStage("left")}
                disabled={!canMoveLeft}
                className="flex h-7 w-7 items-center justify-center rounded text-light-700 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 disabled:opacity-30 dark:text-dark-700 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
                aria-label={t`Move ${stage.name} left`}
              >
                <HiChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onMoveStage("right")}
                disabled={!canMoveRight}
                className="flex h-7 w-7 items-center justify-center rounded text-light-700 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 disabled:opacity-30 dark:text-dark-700 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
                aria-label={t`Move ${stage.name} right`}
              >
                <HiChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
        {canEdit && (
          <div className="mt-2 flex items-center gap-2 pl-0 min-[1400px]:pl-7">
            <div className="max-w-[10rem] flex-1">
              <AccentColourSelector
                value={stage.colourCode}
                onChange={(colourCode) =>
                  onUpdateStage({
                    stagePublicId: stage.publicId,
                    colourCode,
                  })
                }
                compact
              />
            </div>
          </div>
        )}
      </div>
      <Droppable droppableId={stage.publicId} type="SUBTASK">
        {(droppableProvided, snapshot) => (
          <div
            ref={droppableProvided.innerRef}
            {...droppableProvided.droppableProps}
            className={twMerge(
              "min-h-16 flex-1 overflow-y-auto bg-light-50 dark:bg-dark-100",
              snapshot.isDraggingOver && "bg-blue-50 dark:bg-blue-950/20",
            )}
          >
            {stage.subtasks.map((subtask, index) => (
              <Draggable
                key={subtask.publicId}
                draggableId={subtask.publicId}
                index={index}
                isDragDisabled={!canEdit}
              >
                {(subtaskProvided, subtaskSnapshot) => (
                  <SubtaskCard
                    subtask={subtask}
                    provided={subtaskProvided}
                    isDragging={subtaskSnapshot.isDragging}
                    onOpen={() => onOpenSubtask(subtask.publicId)}
                  />
                )}
              </Draggable>
            ))}
            {droppableProvided.placeholder}
            {stage.subtasks.length === 0 && !isCreating && (
              <p className="px-4 py-8 text-center text-xs leading-5 text-light-700 dark:text-dark-700">
                {t`No subtasks in this stage`}
              </p>
            )}
          </div>
        )}
      </Droppable>
      {canEdit && (
        <div className="border-t border-light-300 bg-light-50 p-2 dark:border-dark-400 dark:bg-dark-100">
          {isCreating ? (
            <div>
              <input
                autoFocus
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submitSubtask();
                  if (event.key === "Escape") onCancelCreate();
                }}
                maxLength={500}
                disabled={isSubmitting}
                aria-label={t`Subtask title`}
                placeholder={t`What needs to be done?`}
                className="w-full rounded-md border border-light-400 bg-light-50 px-3 py-2 text-sm text-light-1000 placeholder:text-light-700 focus:border-light-800 focus:ring-light-800 dark:border-dark-500 dark:bg-dark-200 dark:text-dark-1000 dark:placeholder:text-dark-700 dark:focus:border-dark-800 dark:focus:ring-dark-800"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void submitSubtask()}
                  disabled={!newTitle.trim() || isSubmitting}
                  className="rounded-md bg-light-1000 px-3 py-1.5 text-xs font-semibold text-light-50 disabled:opacity-50 dark:bg-dark-1000 dark:text-dark-50"
                >
                  {t`Add subtask`}
                </button>
                <button
                  type="button"
                  onClick={onCancelCreate}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-light-800 hover:bg-light-200 dark:text-dark-800 dark:hover:bg-dark-200"
                  aria-label={t`Cancel`}
                >
                  <HiXMark className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={onBeginCreate}
              className="flex w-full items-center gap-1 rounded-md px-2 py-2 text-xs font-medium text-light-800 hover:bg-light-200 hover:text-light-1000 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:text-dark-800 dark:hover:bg-dark-200 dark:hover:text-dark-1000 dark:focus-visible:ring-dark-800"
            >
              <HiPlusSmall className="h-4 w-4" />
              {t`Add subtask`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
