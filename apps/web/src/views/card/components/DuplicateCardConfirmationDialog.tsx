import { Dialog, Transition } from "@headlessui/react";
import { t } from "@lingui/core/macro";
import { Fragment } from "react";

import Button from "~/components/Button";
import { DuplicateResourcesNotice } from "~/components/DuplicateResourcesNotice";
import { PublicResourceVisibilityNotice } from "~/components/PublicResourceVisibilityNotice";

interface DuplicateCardConfirmationDialogProps {
  isOpen: boolean;
  isLoading: boolean;
  uploadCount: number;
  publicLinkCount?: number;
  publicLinksAreDriveOnly: boolean;
  requiresPublicVisibilityAcknowledgement: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DuplicateCardConfirmationDialog({
  isOpen,
  isLoading,
  uploadCount,
  publicLinkCount,
  publicLinksAreDriveOnly,
  requiresPublicVisibilityAcknowledgement,
  onCancel,
  onConfirm,
}: DuplicateCardConfirmationDialogProps) {
  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog
        as="div"
        className="relative z-[150]"
        onClose={isLoading ? () => undefined : onCancel}
      >
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
                <Dialog.Title className="text-base font-semibold text-light-1000 dark:text-dark-1000">
                  {t`Duplicate card`}
                </Dialog.Title>
                <Dialog.Description className="mt-2 text-sm leading-6 text-light-800 dark:text-dark-800">
                  {t`Review what will stay with the original before continuing.`}
                </Dialog.Description>
                <div className="mt-4 space-y-3">
                  {uploadCount > 0 && (
                    <DuplicateResourcesNotice uploadCount={uploadCount} />
                  )}
                  {requiresPublicVisibilityAcknowledgement && (
                    <PublicResourceVisibilityNotice
                      resourceCount={publicLinkCount}
                      driveOnly={publicLinksAreDriveOnly}
                    />
                  )}
                </div>
                <div className="mt-6 flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={onCancel}
                    disabled={isLoading}
                  >
                    {t`Cancel`}
                  </Button>
                  <Button
                    type="button"
                    onClick={onConfirm}
                    isLoading={isLoading}
                  >
                    {requiresPublicVisibilityAcknowledgement
                      ? t`Confirm and duplicate`
                      : t`Duplicate card`}
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
