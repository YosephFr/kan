import { Dialog, Transition } from "@headlessui/react";
import { t } from "@lingui/core/macro";
import { Fragment } from "react";
import {
  HiArrowDownTray,
  HiOutlineExclamationTriangle,
  HiOutlineServerStack,
} from "react-icons/hi2";

import Button from "~/components/Button";

interface CardCanvasConflictDialogProps {
  open: boolean;
  remoteVersion: number | null;
  isLoadingRemote: boolean;
  onDownloadLocal: () => void;
  onLoadRemote: () => void;
}

export function CardCanvasConflictDialog({
  open,
  remoteVersion,
  isLoadingRemote,
  onDownloadLocal,
  onLoadRemote,
}: CardCanvasConflictDialogProps) {
  return (
    <Transition.Root show={open} as={Fragment}>
      <Dialog as="div" className="relative z-[180]" onClose={() => undefined}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/40" />
        </Transition.Child>
        <div className="fixed inset-0 overflow-y-auto p-4">
          <div className="flex min-h-full items-center justify-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="translate-y-4 opacity-0 sm:scale-95"
              enterTo="translate-y-0 opacity-100 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="translate-y-0 opacity-100 sm:scale-100"
              leaveTo="translate-y-4 opacity-0 sm:scale-95"
            >
              <Dialog.Panel className="w-full max-w-md rounded-lg border border-light-400 bg-light-50 p-6 text-left shadow-xl dark:border-dark-500 dark:bg-dark-100">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                  <HiOutlineExclamationTriangle className="h-5 w-5" />
                </div>
                <Dialog.Title className="mt-4 text-base font-semibold text-light-1000 dark:text-dark-1000">
                  {t`This whiteboard changed elsewhere`}
                </Dialog.Title>
                <Dialog.Description className="mt-2 text-sm leading-6 text-light-800 dark:text-dark-800">
                  {t`Your local work is still visible and saved on this device. Automatic server saving has stopped so neither version is overwritten.`}
                </Dialog.Description>
                {remoteVersion !== null && (
                  <p className="mt-3 text-xs text-light-600 dark:text-dark-600">
                    {t`Remote version: ${remoteVersion}`}
                  </p>
                )}
                <div className="mt-6 grid gap-2 sm:grid-cols-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={onDownloadLocal}
                    iconLeft={<HiArrowDownTray className="h-4 w-4" />}
                  >
                    {t`Download local copy`}
                  </Button>
                  <Button
                    type="button"
                    onClick={onLoadRemote}
                    isLoading={isLoadingRemote}
                    iconLeft={<HiOutlineServerStack className="h-4 w-4" />}
                  >
                    {t`Load remote version`}
                  </Button>
                </div>
                <p className="mt-3 text-[11px] leading-5 text-light-600 dark:text-dark-600">
                  {t`Loading the remote version removes this device's local draft. Download it first if you want to keep it.`}
                </p>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
