import { Dialog, Transition } from "@headlessui/react";
import { t } from "@lingui/core/macro";
import { Fragment } from "react";
import { HiOutlineGlobeAlt } from "react-icons/hi2";

import Button from "~/components/Button";

interface CardCanvasPasteUploadDialogProps {
  open: boolean;
  filename: string;
  isUploading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function CardCanvasPasteUploadDialog({
  open,
  filename,
  isUploading,
  onCancel,
  onConfirm,
}: CardCanvasPasteUploadDialogProps) {
  return (
    <Transition.Root show={open} as={Fragment}>
      <Dialog
        as="div"
        className="relative z-[175]"
        onClose={isUploading ? () => undefined : onCancel}
      >
        <div className="fixed inset-0 bg-black/35" />
        <div className="fixed inset-0 overflow-y-auto p-4">
          <div className="flex min-h-full items-center justify-center">
            <Dialog.Panel className="w-full max-w-sm rounded-lg border border-light-400 bg-light-50 p-5 shadow-xl dark:border-dark-500 dark:bg-dark-100">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                <HiOutlineGlobeAlt className="h-5 w-5" />
              </div>
              <Dialog.Title className="mt-4 text-sm font-semibold text-light-1000 dark:text-dark-1000">
                {t`Upload image to a public board?`}
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-xs leading-5 text-light-700 dark:text-dark-700">
                {t`Anyone who can open this public board will be able to preview ${filename}. The image must be stored as a card resource before it can appear safely on the whiteboard.`}
              </Dialog.Description>
              <div className="mt-5 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={onCancel}
                  disabled={isUploading}
                >
                  {t`Cancel`}
                </Button>
                <Button
                  type="button"
                  onClick={onConfirm}
                  isLoading={isUploading}
                >
                  {t`I understand, upload`}
                </Button>
              </div>
            </Dialog.Panel>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
