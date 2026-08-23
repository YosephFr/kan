import { Dialog, Transition } from "@headlessui/react";
import { t } from "@lingui/core/macro";
import { Fragment, useEffect, useState } from "react";
import { HiOutlineArrowRightCircle, HiXMark } from "react-icons/hi2";

import type { CardCanvasSubtaskFields } from "./card-canvas-types";
import type {
  PipelineStageStatus,
  WorkspaceMemberOption,
} from "./subtask-types";
import Button from "~/components/Button";
import { fromLocalDateTimeInput } from "~/utils/card-workspace";
import { formatMemberDisplayName } from "~/utils/helpers";

interface CardCanvasConvertDialogProps {
  open: boolean;
  defaultTitle: string;
  members: WorkspaceMemberOption[];
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (
    targetStageStatus: PipelineStageStatus,
    fields: CardCanvasSubtaskFields,
  ) => void;
}

const stageOptions: { value: PipelineStageStatus; label: () => string }[] = [
  { value: "planned", label: () => t`Planned` },
  { value: "inProgress", label: () => t`In progress` },
  { value: "blocked", label: () => t`Blocked` },
  { value: "done", label: () => t`Done` },
];

export function CardCanvasConvertDialog({
  open,
  defaultTitle,
  members,
  isSaving,
  onClose,
  onSubmit,
}: CardCanvasConvertDialogProps) {
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState("");
  const [stageStatus, setStageStatus] =
    useState<PipelineStageStatus>("planned");
  const [priority, setPriority] =
    useState<CardCanvasSubtaskFields["priority"]>("none");
  const [ownerPublicId, setOwnerPublicId] = useState("");
  const [dueDate, setDueDate] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle(defaultTitle);
    setDescription("");
    setStageStatus("planned");
    setPriority("none");
    setOwnerPublicId("");
    setDueDate("");
  }, [defaultTitle, open]);

  const submit = () => {
    const nextTitle = title.trim();
    if (!nextTitle || isSaving) return;
    const parsedDueDate = fromLocalDateTimeInput(dueDate);
    onSubmit(stageStatus, {
      title: nextTitle,
      ...(description.trim() && { description: description.trim() }),
      ...(priority && { priority }),
      ...(ownerPublicId && { ownerPublicId }),
      ...(parsedDueDate && { dueDate: parsedDueDate }),
    });
  };

  return (
    <Transition.Root show={open} as={Fragment}>
      <Dialog
        as="div"
        className="relative z-[170]"
        onClose={isSaving ? () => undefined : onClose}
      >
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-250"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/35" />
        </Transition.Child>
        <div className="fixed inset-0 overflow-y-auto p-0 sm:p-4">
          <div className="flex min-h-full items-end justify-center sm:items-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-250"
              enterFrom="translate-y-5 opacity-0 sm:scale-95"
              enterTo="translate-y-0 opacity-100 sm:scale-100"
              leave="ease-in duration-150"
              leaveFrom="translate-y-0 opacity-100 sm:scale-100"
              leaveTo="translate-y-5 opacity-0 sm:scale-95"
            >
              <Dialog.Panel className="w-full rounded-t-xl border border-light-400 bg-light-50 shadow-xl dark:border-dark-500 dark:bg-dark-100 sm:max-w-xl sm:rounded-lg">
                <div className="flex items-start justify-between border-b border-light-300 px-5 py-4 dark:border-dark-400">
                  <div>
                    <Dialog.Title className="text-base font-semibold text-light-1000 dark:text-dark-1000">
                      {t`Convert zone to subtask`}
                    </Dialog.Title>
                    <Dialog.Description className="mt-1 text-xs leading-5 text-light-700 dark:text-dark-700">
                      {t`The zone stays on the whiteboard and gains a live link to its subtask.`}
                    </Dialog.Description>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={isSaving}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-light-700 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 disabled:opacity-50 dark:text-dark-700 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
                    aria-label={t`Close`}
                  >
                    <HiXMark className="h-5 w-5" />
                  </button>
                </div>
                <div className="max-h-[calc(100dvh-8rem)] overflow-y-auto px-5 py-5">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-light-900 dark:text-dark-900">
                      {t`Title`}
                    </span>
                    <input
                      autoFocus
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      maxLength={500}
                      className="w-full rounded-md border border-light-400 bg-light-50 px-3 py-2 text-sm text-light-1000 focus:border-light-800 focus:ring-light-800 dark:border-dark-500 dark:bg-dark-200 dark:text-dark-1000 dark:focus:border-dark-800 dark:focus:ring-dark-800"
                    />
                  </label>
                  <label className="mt-4 block">
                    <span className="mb-1.5 block text-xs font-medium text-light-900 dark:text-dark-900">
                      {t`Description`}
                    </span>
                    <textarea
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      rows={3}
                      maxLength={10000}
                      className="w-full resize-y rounded-md border border-light-400 bg-light-50 px-3 py-2 text-sm text-light-1000 focus:border-light-800 focus:ring-light-800 dark:border-dark-500 dark:bg-dark-200 dark:text-dark-1000 dark:focus:border-dark-800 dark:focus:ring-dark-800"
                    />
                  </label>
                  <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium text-light-900 dark:text-dark-900">
                        {t`Stage`}
                      </span>
                      <select
                        value={stageStatus}
                        onChange={(event) =>
                          setStageStatus(
                            event.target.value as PipelineStageStatus,
                          )
                        }
                        className="w-full rounded-md border border-light-400 bg-light-50 px-3 py-2 text-xs text-light-1000 focus:border-light-800 focus:ring-light-800 dark:border-dark-500 dark:bg-dark-200 dark:text-dark-1000 dark:focus:border-dark-800 dark:focus:ring-dark-800"
                      >
                        {stageOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label()}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium text-light-900 dark:text-dark-900">
                        {t`Priority`}
                      </span>
                      <select
                        value={priority}
                        onChange={(event) =>
                          setPriority(
                            event.target
                              .value as CardCanvasSubtaskFields["priority"],
                          )
                        }
                        className="w-full rounded-md border border-light-400 bg-light-50 px-3 py-2 text-xs text-light-1000 focus:border-light-800 focus:ring-light-800 dark:border-dark-500 dark:bg-dark-200 dark:text-dark-1000 dark:focus:border-dark-800 dark:focus:ring-dark-800"
                      >
                        <option value="none">{t`No priority`}</option>
                        <option value="low">{t`Low`}</option>
                        <option value="medium">{t`Medium`}</option>
                        <option value="high">{t`High`}</option>
                        <option value="urgent">{t`Urgent`}</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium text-light-900 dark:text-dark-900">
                        {t`Owner`}
                      </span>
                      <select
                        value={ownerPublicId}
                        onChange={(event) =>
                          setOwnerPublicId(event.target.value)
                        }
                        className="w-full rounded-md border border-light-400 bg-light-50 px-3 py-2 text-xs text-light-1000 focus:border-light-800 focus:ring-light-800 dark:border-dark-500 dark:bg-dark-200 dark:text-dark-1000 dark:focus:border-dark-800 dark:focus:ring-dark-800"
                      >
                        <option value="">{t`Unassigned`}</option>
                        {members.map((member) => (
                          <option key={member.publicId} value={member.publicId}>
                            {formatMemberDisplayName(
                              member.user?.name ?? null,
                              member.user?.email ?? member.email,
                            )}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium text-light-900 dark:text-dark-900">
                        {t`Due date and time`}
                      </span>
                      <input
                        type="datetime-local"
                        value={dueDate}
                        onChange={(event) => setDueDate(event.target.value)}
                        className="w-full rounded-md border border-light-400 bg-light-50 px-3 py-2 text-xs text-light-1000 focus:border-light-800 focus:ring-light-800 dark:border-dark-500 dark:bg-dark-200 dark:text-dark-1000 dark:focus:border-dark-800 dark:focus:ring-dark-800"
                      />
                    </label>
                  </div>
                  <div className="mt-6 flex justify-end gap-2 border-t border-light-300 pt-4 dark:border-dark-400">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={onClose}
                      disabled={isSaving}
                    >
                      {t`Cancel`}
                    </Button>
                    <Button
                      type="button"
                      onClick={submit}
                      disabled={!title.trim()}
                      isLoading={isSaving}
                      iconRight={
                        <HiOutlineArrowRightCircle className="h-4 w-4" />
                      }
                    >
                      {t`Create subtask`}
                    </Button>
                  </div>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
