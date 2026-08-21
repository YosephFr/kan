import { Dialog, Transition } from "@headlessui/react";
import { t } from "@lingui/core/macro";
import { Fragment } from "react";
import { HiExclamationTriangle } from "react-icons/hi2";

import Button from "~/components/Button";

interface OpenSubtasksConfirmationDialogProps {
  isOpen: boolean;
  openCount: number;
  isLoading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function OpenSubtasksConfirmationDialog({
  isOpen,
  openCount,
  isLoading = false,
  onCancel,
  onConfirm,
}: OpenSubtasksConfirmationDialogProps) {
  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-[150]" onClose={onCancel}>
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
        <div className="fixed inset-0 overflow-y-auto p-4">
          <div className="flex min-h-full items-center justify-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="translate-y-3 opacity-0 scale-95"
              enterTo="translate-y-0 opacity-100 scale-100"
              leave="ease-in duration-150"
              leaveFrom="translate-y-0 opacity-100 scale-100"
              leaveTo="translate-y-3 opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-md rounded-lg border border-light-300 bg-light-50 p-5 shadow-xl dark:border-dark-400 dark:bg-dark-100">
                <span className="flex h-9 w-9 items-center justify-center rounded-md bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                  <HiExclamationTriangle
                    className="h-5 w-5"
                    aria-hidden="true"
                  />
                </span>
                <Dialog.Title className="mt-4 text-base font-semibold text-light-1000 dark:text-dark-1000">
                  {t`This card still has open subtasks`}
                </Dialog.Title>
                <Dialog.Description className="mt-2 text-sm leading-6 text-light-800 dark:text-dark-800">
                  {openCount === 1
                    ? t`One subtask is still open. Moving the card to a completed list will not close it automatically.`
                    : t`${openCount} subtasks are still open. Moving the card to a completed list will not close them automatically.`}
                </Dialog.Description>
                <div className="mt-6 flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={onCancel}
                    disabled={isLoading}
                  >
                    {t`Keep working`}
                  </Button>
                  <Button
                    type="button"
                    onClick={onConfirm}
                    isLoading={isLoading}
                  >
                    {t`Move anyway`}
                  </Button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
