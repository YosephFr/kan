import { Dialog, Transition } from "@headlessui/react";
import { t } from "@lingui/core/macro";
import { Fragment, useEffect, useRef, useState } from "react";
import {
  HiOutlineCalendarDays,
  HiOutlinePencilSquare,
  HiOutlineTrash,
  HiPlusSmall,
  HiXMark,
} from "react-icons/hi2";

import type {
  CardPipelineStage,
  CardSubtask,
  SubtaskChecklistItem,
  WorkspaceMemberOption,
} from "./subtask-types";
import Avatar from "~/components/Avatar";
import PrioritySelector from "~/components/PrioritySelector";
import { getLocalTimeZone } from "~/utils/card-presentation";
import {
  fromLocalDateTimeInput,
  toLocalDateTimeInput,
} from "~/utils/card-workspace";
import { formatMemberDisplayName, getAvatarUrl } from "~/utils/helpers";
import { SubtaskResourceSection } from "./SubtaskResourceSection";

interface SubtaskEditorDialogProps {
  cardPublicId: string;
  subtask: CardSubtask | null;
  stages: CardPipelineStage[];
  members: WorkspaceMemberOption[];
  canEdit: boolean;
  isSaving: boolean;
  titleResetVersion: number;
  descriptionResetVersion: number;
  checklistResetVersion: number;
  onClose: () => void;
  onUpdate: (
    input: Partial<
      Pick<CardSubtask, "title" | "description" | "priority" | "dueDate">
    >,
  ) => void;
  onMove: (stagePublicId: string) => void;
  onSetOwner: (ownerPublicId: string | null) => void;
  onCreateChecklistItem: (title: string) => Promise<void>;
  onUpdateChecklistItem: (
    checklistItemPublicId: string,
    input: { title?: string; completed?: boolean },
  ) => void;
  onDeleteChecklistItem: (checklistItemPublicId: string) => void;
  onOpenResource: (resourcePublicId: string) => void;
  onOpenCanvasFrame: (framePublicId: string) => void;
  onDelete: () => void;
}

function ChecklistItemTitleInput({
  item,
  canEdit,
  resetVersion,
  onUpdate,
}: {
  item: SubtaskChecklistItem;
  canEdit: boolean;
  resetVersion: number;
  onUpdate: (title: string) => void;
}) {
  const [value, setValue] = useState(item.title);

  useEffect(() => setValue(item.title), [item.title, resetVersion]);

  const commit = () => {
    if (!canEdit) {
      setValue(item.title);
      return;
    }
    const nextTitle = value.trim();
    if (!nextTitle) {
      setValue(item.title);
      return;
    }
    if (nextTitle !== item.title) onUpdate(nextTitle);
  };

  return (
    <input
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setValue(item.title);
          event.currentTarget.blur();
        }
      }}
      readOnly={!canEdit}
      maxLength={500}
      aria-label={t`Checklist item: ${item.title}`}
      className="min-w-0 flex-1 border-0 bg-transparent px-1 py-1 text-sm text-light-950 focus:ring-0 focus-visible:outline-none dark:text-dark-950"
    />
  );
}

export function SubtaskEditorDialog({
  cardPublicId,
  subtask,
  stages,
  members,
  canEdit,
  isSaving,
  titleResetVersion,
  descriptionResetVersion,
  checklistResetVersion,
  onClose,
  onUpdate,
  onMove,
  onSetOwner,
  onCreateChecklistItem,
  onUpdateChecklistItem,
  onDeleteChecklistItem,
  onOpenResource,
  onOpenCanvasFrame,
  onDelete,
}: SubtaskEditorDialogProps) {
  const [title, setTitle] = useState(subtask?.title ?? "");
  const [description, setDescription] = useState(subtask?.description ?? "");
  const [newChecklistTitle, setNewChecklistTitle] = useState("");
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const previousTitleResetVersion = useRef(titleResetVersion);
  const previousDescriptionResetVersion = useRef(descriptionResetVersion);

  useEffect(() => {
    if (previousTitleResetVersion.current === titleResetVersion) return;
    previousTitleResetVersion.current = titleResetVersion;
    setTitle(subtask?.title ?? "");
  }, [subtask?.title, titleResetVersion]);

  useEffect(() => {
    if (previousDescriptionResetVersion.current === descriptionResetVersion) {
      return;
    }
    previousDescriptionResetVersion.current = descriptionResetVersion;
    setDescription(subtask?.description ?? "");
  }, [descriptionResetVersion, subtask?.description]);

  const commitTitle = () => {
    if (!subtask) return;
    if (!canEdit) {
      setTitle(subtask.title);
      return;
    }
    const nextTitle = title.trim();
    if (!nextTitle) {
      setTitle(subtask.title);
      return;
    }
    if (nextTitle !== subtask.title) onUpdate({ title: nextTitle });
  };

  const commitDescription = () => {
    if (!subtask) return;
    if (!canEdit) {
      setDescription(subtask.description ?? "");
      return;
    }
    const nextDescription = description.trim();
    if (nextDescription !== (subtask.description ?? "")) {
      onUpdate({ description: nextDescription || null });
    }
  };

  const addChecklistItem = async () => {
    if (!canEdit) return;
    const nextTitle = newChecklistTitle.trim();
    if (!nextTitle) return;
    try {
      await onCreateChecklistItem(nextTitle);
      setNewChecklistTitle("");
    } catch {
      return;
    }
  };

  const completedChecklistItems =
    subtask?.checklistItems.filter((item) => item.completed).length ?? 0;
  const checklistProgress = subtask?.checklistItems.length
    ? Math.round(
        (completedChecklistItems / subtask.checklistItems.length) * 100,
      )
    : 0;
  const canvasFramePublicId = subtask?.canvasFrame?.publicId ?? null;

  return (
    <Transition.Root show={subtask !== null} as={Fragment}>
      <Dialog as="div" className="relative z-[140]" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/30" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto md:p-4">
          <div className="flex min-h-full items-end justify-center md:items-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="translate-y-6 opacity-0 md:scale-95"
              enterTo="translate-y-0 opacity-100 md:scale-100"
              leave="ease-in duration-150"
              leaveFrom="translate-y-0 opacity-100 md:scale-100"
              leaveTo="translate-y-6 opacity-0 md:scale-95"
            >
              <Dialog.Panel className="flex h-[calc(100dvh-3rem)] w-full flex-col overflow-hidden rounded-t-xl border border-light-300 bg-light-50 shadow-xl dark:border-dark-400 dark:bg-dark-100 md:h-auto md:max-h-[min(46rem,calc(100dvh-2rem))] md:max-w-2xl md:rounded-lg">
                {subtask && (
                  <>
                    <Dialog.Title className="sr-only">
                      {t`Subtask details`}
                    </Dialog.Title>
                    <div className="flex items-center justify-between border-b border-light-300 px-5 py-3 dark:border-dark-400">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full bg-light-500 dark:bg-dark-500"
                          style={{
                            backgroundColor:
                              stages.find(
                                (stage) =>
                                  stage.publicId === subtask.stagePublicId,
                              )?.colourCode ?? undefined,
                          }}
                        />
                        <span className="truncate text-xs font-medium text-light-800 dark:text-dark-800">
                          {stages.find(
                            (stage) => stage.publicId === subtask.stagePublicId,
                          )?.name ?? t`Subtask`}
                        </span>
                        {isSaving && (
                          <span className="text-[10px] text-light-700 dark:text-dark-700">
                            {t`Saving…`}
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {canvasFramePublicId && (
                          <button
                            type="button"
                            onClick={() =>
                              onOpenCanvasFrame(canvasFramePublicId)
                            }
                            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-light-800 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:text-dark-800 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
                          >
                            <HiOutlinePencilSquare className="h-4 w-4" />
                            <span className="hidden sm:inline">
                              {t`Open visual wall`}
                            </span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={onClose}
                          className="flex h-8 w-8 items-center justify-center rounded-md text-light-800 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:text-dark-800 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
                          aria-label={t`Close subtask`}
                        >
                          <HiXMark className="h-5 w-5" />
                        </button>
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto px-5 py-5 md:px-7">
                      <textarea
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        onBlur={commitTitle}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            setTitle(subtask.title);
                            event.currentTarget.blur();
                          }
                        }}
                        rows={2}
                        maxLength={500}
                        readOnly={!canEdit}
                        aria-label={t`Subtask title`}
                        className="w-full resize-none border-0 bg-transparent p-0 text-xl font-semibold leading-7 text-light-1000 focus:ring-0 focus-visible:outline-none dark:text-dark-1000"
                      />

                      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-1.5 block text-xs font-medium text-light-800 dark:text-dark-800">
                            {t`Stage`}
                          </span>
                          <select
                            value={subtask.stagePublicId}
                            onChange={(event) => onMove(event.target.value)}
                            disabled={!canEdit}
                            className="w-full rounded-md border border-light-400 bg-light-50 px-2.5 py-2 text-xs text-light-950 focus:border-light-800 focus:ring-light-800 disabled:opacity-60 dark:border-dark-500 dark:bg-dark-200 dark:text-dark-950 dark:focus:border-dark-800 dark:focus:ring-dark-800"
                          >
                            {stages.map((stage) => (
                              <option
                                key={stage.publicId}
                                value={stage.publicId}
                              >
                                {stage.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div>
                          <span className="mb-1.5 block text-xs font-medium text-light-800 dark:text-dark-800">
                            {t`Priority`}
                          </span>
                          <PrioritySelector
                            value={subtask.priority}
                            onChange={(priority) => onUpdate({ priority })}
                            disabled={!canEdit}
                          />
                        </div>
                        <label className="block">
                          <span className="mb-1.5 block text-xs font-medium text-light-800 dark:text-dark-800">
                            {t`Owner`}
                          </span>
                          {canEdit ? (
                            <select
                              value={subtask.owner?.publicId ?? ""}
                              onChange={(event) =>
                                onSetOwner(event.target.value || null)
                              }
                              className="w-full rounded-md border border-light-400 bg-light-50 px-2.5 py-2 text-xs text-light-950 focus:border-light-800 focus:ring-light-800 dark:border-dark-500 dark:bg-dark-200 dark:text-dark-950 dark:focus:border-dark-800 dark:focus:ring-dark-800"
                            >
                              <option value="">{t`Unassigned`}</option>
                              {subtask.owner &&
                                !members.some(
                                  (member) =>
                                    member.publicId === subtask.owner?.publicId,
                                ) && (
                                  <option
                                    value={subtask.owner.publicId}
                                    disabled
                                  >
                                    {subtask.owner.name ?? t`Member`} —{" "}
                                    {t`Inactive member`}
                                  </option>
                                )}
                              {members.map((member) => (
                                <option
                                  key={member.publicId}
                                  value={member.publicId}
                                >
                                  {formatMemberDisplayName(
                                    member.user?.name ?? null,
                                    member.user?.email ?? member.email,
                                  )}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <div className="flex min-h-9 items-center gap-2 rounded-md border border-light-300 px-2.5 py-1.5 text-xs text-light-950 dark:border-dark-400 dark:text-dark-950">
                              {subtask.owner ? (
                                <>
                                  <Avatar
                                    size="xs"
                                    name={subtask.owner.name ?? ""}
                                    email=""
                                    imageUrl={
                                      subtask.owner.image
                                        ? getAvatarUrl(subtask.owner.image)
                                        : undefined
                                    }
                                  />
                                  <span>{subtask.owner.name ?? t`Member`}</span>
                                </>
                              ) : (
                                <span className="text-light-700 dark:text-dark-700">
                                  {t`Unassigned`}
                                </span>
                              )}
                            </div>
                          )}
                        </label>
                        <label className="block">
                          <span className="mb-1.5 flex items-center gap-1 text-xs font-medium text-light-800 dark:text-dark-800">
                            <HiOutlineCalendarDays className="h-4 w-4" />
                            {t`Due date and time`}
                          </span>
                          <input
                            type="datetime-local"
                            value={toLocalDateTimeInput(subtask.dueDate)}
                            onChange={(event) =>
                              onUpdate({
                                dueDate: fromLocalDateTimeInput(
                                  event.target.value,
                                ),
                              })
                            }
                            disabled={!canEdit}
                            className="w-full rounded-md border border-light-400 bg-light-50 px-2.5 py-2 text-xs text-light-950 focus:border-light-800 focus:ring-light-800 disabled:opacity-60 dark:border-dark-500 dark:bg-dark-200 dark:text-dark-950 dark:focus:border-dark-800 dark:focus:ring-dark-800"
                          />
                          <span className="mt-1 block text-[10px] text-light-700 dark:text-dark-700">
                            {getLocalTimeZone()}
                          </span>
                        </label>
                      </div>

                      <div className="mt-7">
                        <label
                          htmlFor={`subtask-description-${subtask.publicId}`}
                          className="mb-2 block text-sm font-medium text-light-1000 dark:text-dark-1000"
                        >
                          {t`Description`}
                        </label>
                        <textarea
                          id={`subtask-description-${subtask.publicId}`}
                          value={description}
                          onChange={(event) =>
                            setDescription(event.target.value)
                          }
                          onBlur={commitDescription}
                          rows={5}
                          maxLength={10000}
                          readOnly={!canEdit}
                          placeholder={t`Add the context needed to complete this subtask…`}
                          className="w-full resize-y rounded-md border border-light-400 bg-light-50 px-3 py-2 text-sm leading-6 text-light-950 placeholder:text-light-700 focus:border-light-800 focus:ring-light-800 disabled:opacity-60 dark:border-dark-500 dark:bg-dark-200 dark:text-dark-950 dark:placeholder:text-dark-700 dark:focus:border-dark-800 dark:focus:ring-dark-800"
                        />
                      </div>

                      <div className="mt-7 border-t border-light-300 pt-6 dark:border-dark-400">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-medium text-light-1000 dark:text-dark-1000">
                              {t`Steps to complete`}
                            </h3>
                            {subtask.checklistItems.length > 0 && (
                              <p className="mt-0.5 text-xs text-light-700 dark:text-dark-700">
                                {completedChecklistItems}/
                                {subtask.checklistItems.length} ·{" "}
                                {checklistProgress}%
                              </p>
                            )}
                          </div>
                        </div>
                        {subtask.checklistItems.length > 0 && (
                          <div
                            role="progressbar"
                            aria-label={t`Checklist progress`}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={checklistProgress}
                            className="mt-3 h-1 overflow-hidden rounded-full bg-light-300 dark:bg-dark-400"
                          >
                            <div
                              className="h-full rounded-full bg-blue-600 transition-[width] duration-500"
                              style={{ width: `${checklistProgress}%` }}
                            />
                          </div>
                        )}
                        <div className="mt-3 divide-y divide-light-300 border-y border-light-300 dark:divide-dark-400 dark:border-dark-400">
                          {subtask.checklistItems.map((item) => (
                            <div
                              key={item.publicId}
                              className="group flex items-center gap-2 py-2"
                            >
                              <input
                                type="checkbox"
                                checked={item.completed}
                                onChange={(event) =>
                                  onUpdateChecklistItem(item.publicId, {
                                    completed: event.target.checked,
                                  })
                                }
                                disabled={!canEdit}
                                aria-label={t`Toggle ${item.title}`}
                                className="h-4 w-4 rounded border-light-500 text-blue-600 focus:ring-blue-600 disabled:opacity-60 dark:border-dark-500"
                              />
                              <ChecklistItemTitleInput
                                item={item}
                                canEdit={canEdit}
                                resetVersion={checklistResetVersion}
                                onUpdate={(nextTitle) =>
                                  onUpdateChecklistItem(item.publicId, {
                                    title: nextTitle,
                                  })
                                }
                              />
                              {canEdit && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onDeleteChecklistItem(item.publicId)
                                  }
                                  className="flex h-7 w-7 items-center justify-center rounded-md text-light-700 hover:bg-light-200 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:text-dark-700 dark:hover:bg-dark-200 dark:hover:text-red-400 dark:focus-visible:ring-dark-800 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                                  aria-label={t`Delete checklist item`}
                                >
                                  <HiXMark className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                        {canEdit && (
                          <div className="mt-3 flex gap-2">
                            <input
                              value={newChecklistTitle}
                              onChange={(event) =>
                                setNewChecklistTitle(event.target.value)
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  void addChecklistItem();
                                }
                              }}
                              maxLength={500}
                              disabled={isSaving}
                              aria-label={t`Checklist item title`}
                              placeholder={t`Add a step…`}
                              className="min-w-0 flex-1 rounded-md border border-light-400 bg-light-50 px-3 py-2 text-sm text-light-950 placeholder:text-light-700 focus:border-light-800 focus:ring-light-800 dark:border-dark-500 dark:bg-dark-200 dark:text-dark-950 dark:placeholder:text-dark-700 dark:focus:border-dark-800 dark:focus:ring-dark-800"
                            />
                            <button
                              type="button"
                              onClick={() => void addChecklistItem()}
                              disabled={!newChecklistTitle.trim() || isSaving}
                              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-light-500 text-light-900 hover:bg-light-200 disabled:opacity-50 dark:border-dark-500 dark:text-dark-900 dark:hover:bg-dark-200"
                              aria-label={t`Add checklist item`}
                            >
                              <HiPlusSmall className="h-5 w-5" />
                            </button>
                          </div>
                        )}
                      </div>

                      <SubtaskResourceSection
                        cardPublicId={cardPublicId}
                        subtaskPublicId={subtask.publicId}
                        resources={subtask.resources}
                        canEdit={canEdit}
                        onOpenResource={onOpenResource}
                      />

                      {canEdit && (
                        <div className="mt-8 border-t border-light-300 pt-5 dark:border-dark-400">
                          {isConfirmingDelete ? (
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <p className="text-xs text-red-700 dark:text-red-400">
                                {t`Delete this subtask and its checklist?`}
                              </p>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => setIsConfirmingDelete(false)}
                                  className="rounded-md px-3 py-2 text-xs font-medium text-light-900 hover:bg-light-200 dark:text-dark-900 dark:hover:bg-dark-200"
                                >
                                  {t`Cancel`}
                                </button>
                                <button
                                  type="button"
                                  onClick={onDelete}
                                  className="rounded-md bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700"
                                >
                                  {t`Delete subtask`}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setIsConfirmingDelete(true)}
                              className="flex items-center gap-2 rounded-md px-2 py-2 text-xs font-medium text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                            >
                              <HiOutlineTrash className="h-4 w-4" />
                              {t`Delete subtask`}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
