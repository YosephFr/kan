import { Dialog, Transition } from "@headlessui/react";
import { t } from "@lingui/core/macro";
import { Fragment, useEffect, useState } from "react";
import {
  HiOutlineArrowTrendingUp,
  HiOutlineCheckCircle,
  HiOutlineEllipsisHorizontalCircle,
  HiOutlinePauseCircle,
  HiOutlineQueueList,
} from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

import type { ListStatus } from "~/utils/card-presentation";
import AccentColourSelector from "~/components/AccentColourSelector";
import Button from "~/components/Button";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";

type StatusValue = ListStatus | null;

interface ListSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  list: {
    publicId: string;
    name: string;
    status?: StatusValue;
    colourCode?: string | null;
    cards?: unknown[];
  };
}

const statusPresentation = (status: StatusValue) => {
  switch (status) {
    case "planned":
      return { label: t`Planned`, icon: HiOutlineQueueList };
    case "inProgress":
      return { label: t`In progress`, icon: HiOutlineArrowTrendingUp };
    case "blocked":
      return { label: t`Blocked`, icon: HiOutlinePauseCircle };
    case "done":
      return { label: t`Done`, icon: HiOutlineCheckCircle };
    case "other":
      return { label: t`Other`, icon: HiOutlineEllipsisHorizontalCircle };
    default:
      return {
        label: t`Not classified`,
        icon: HiOutlineEllipsisHorizontalCircle,
      };
  }
};

export default function ListSettingsDialog({
  isOpen,
  onClose,
  list,
}: ListSettingsDialogProps) {
  const utils = api.useUtils();
  const { showPopup } = usePopup();
  const [status, setStatus] = useState<StatusValue>(list.status ?? null);
  const [colourCode, setColourCode] = useState<string | null>(
    list.colourCode ?? null,
  );
  const [needsConfirmation, setNeedsConfirmation] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setStatus(list.status ?? null);
    setColourCode(list.colourCode ?? null);
    setNeedsConfirmation(false);
  }, [isOpen, list.colourCode, list.status]);

  const updateList = api.list.update.useMutation({
    onError: (error) => {
      if (error.data?.code === "BAD_REQUEST") {
        setNeedsConfirmation(true);
        return;
      }
      showPopup({
        header: t`Unable to update list`,
        message: t`Please try again later, or contact customer support.`,
        icon: "error",
      });
    },
    onSuccess: async () => {
      await utils.board.byId.invalidate();
      onClose();
    },
  });

  const save = (confirmed: boolean) => {
    const statusChanged = status !== (list.status ?? null);
    if (statusChanged && (list.cards?.length ?? 0) > 0 && !confirmed) {
      setNeedsConfirmation(true);
      return;
    }

    updateList.mutate({
      listPublicId: list.publicId,
      status,
      colourCode,
      confirmCardLifecycleUpdate: confirmed,
    });
  };

  const statuses: StatusValue[] = [
    null,
    "planned",
    "inProgress",
    "blocked",
    "done",
    "other",
  ];

  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-[210]" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-light-1000/20 dark:bg-dark-50/50" />
        </Transition.Child>
        <div className="fixed inset-0 overflow-y-auto p-4">
          <div className="flex min-h-full items-center justify-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="translate-y-2 opacity-0 scale-95"
              enterTo="translate-y-0 opacity-100 scale-100"
              leave="ease-in duration-150"
              leaveFrom="translate-y-0 opacity-100 scale-100"
              leaveTo="translate-y-2 opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-md rounded-lg border border-light-400 bg-light-50 p-5 text-left shadow-xl dark:border-dark-500 dark:bg-dark-200">
                <Dialog.Title className="text-base font-semibold text-light-1000 dark:text-dark-1000">
                  {t`List appearance and type`}
                </Dialog.Title>
                <p className="mt-1 text-xs text-light-700 dark:text-dark-700">
                  {list.name}
                </p>

                {needsConfirmation ? (
                  <div className="mt-5">
                    <p className="text-sm font-medium text-light-1000 dark:text-dark-1000">
                      {t`Apply this type to existing cards?`}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-light-800 dark:text-dark-800">
                      {t`Changing the list type can start, complete, or reopen the cards currently in this list.`}
                    </p>
                    <div className="mt-6 flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setNeedsConfirmation(false)}
                      >
                        {t`Back`}
                      </Button>
                      <Button
                        type="button"
                        isLoading={updateList.isPending}
                        onClick={() => save(true)}
                      >
                        {t`Apply changes`}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <fieldset className="mt-5">
                      <legend className="text-xs font-medium text-light-900 dark:text-dark-900">
                        {t`List type`}
                      </legend>
                      <div
                        role="radiogroup"
                        className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3"
                      >
                        {statuses.map((statusOption) => {
                          const presentation = statusPresentation(statusOption);
                          const Icon = presentation.icon;
                          return (
                            <button
                              key={statusOption ?? "unclassified"}
                              type="button"
                              role="radio"
                              aria-checked={status === statusOption}
                              onClick={() => setStatus(statusOption)}
                              className={twMerge(
                                "flex min-h-16 flex-col items-start justify-between rounded-md border border-light-400 p-2.5 text-left text-xs text-light-900 hover:bg-light-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-1000 dark:border-dark-500 dark:text-dark-900 dark:hover:bg-dark-300 dark:focus-visible:ring-dark-1000",
                                status === statusOption &&
                                  "border-light-1000 bg-light-100 dark:border-dark-1000 dark:bg-dark-300",
                              )}
                            >
                              <Icon className="h-4 w-4" aria-hidden="true" />
                              <span>{presentation.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </fieldset>
                    <div className="mt-5">
                      <p className="mb-2 text-xs font-medium text-light-900 dark:text-dark-900">
                        {t`List colour`}
                      </p>
                      <AccentColourSelector
                        value={colourCode}
                        onChange={setColourCode}
                      />
                    </div>
                    <div className="mt-6 flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={onClose}
                      >
                        {t`Cancel`}
                      </Button>
                      <Button
                        type="button"
                        isLoading={updateList.isPending}
                        onClick={() => save(false)}
                      >
                        {t`Save`}
                      </Button>
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
