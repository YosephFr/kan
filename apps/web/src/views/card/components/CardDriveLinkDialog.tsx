import { Dialog, Transition } from "@headlessui/react";
import { t } from "@lingui/core/macro";
import { Fragment, useEffect, useState } from "react";
import { HiLink, HiXMark } from "react-icons/hi2";

import Button from "~/components/Button";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import { invalidateCard } from "~/utils/cardInvalidation";

interface CardDriveLinkDialogProps {
  cardPublicId: string;
  isOpen: boolean;
  publicVisibilityAcknowledged?: boolean;
  onVisibilityAcknowledged?: () => void;
  onClose: () => void;
}

export function CardDriveLinkDialog({
  cardPublicId,
  isOpen,
  publicVisibilityAcknowledged,
  onVisibilityAcknowledged,
  onClose,
}: CardDriveLinkDialogProps) {
  const utils = api.useUtils();
  const { showPopup } = usePopup();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [
    requiresVisibilityAcknowledgement,
    setRequiresVisibilityAcknowledgement,
  ] = useState(false);
  const createDriveLink = api.cardResource.createDriveLink.useMutation();

  useEffect(() => {
    if (!isOpen) return;
    setUrl("");
    setTitle("");
    setError(null);
    setRequiresVisibilityAcknowledgement(false);
  }, [isOpen]);

  const submit = async (acknowledgeVisibility = false) => {
    const nextUrl = url.trim();
    if (!nextUrl) return;
    setError(null);
    try {
      await createDriveLink.mutateAsync({
        cardPublicId,
        url: nextUrl,
        title: title.trim() || undefined,
        publicVisibilityAcknowledged:
          acknowledgeVisibility || publicVisibilityAcknowledged,
      });
      await Promise.all([
        utils.cardResource.list.invalidate({ cardPublicId }),
        invalidateCard(utils, cardPublicId),
        utils.board.byId.invalidate(),
      ]);
      showPopup({
        header: t`Drive link added`,
        message: t`The document is now available from this card.`,
        icon: "success",
      });
      onClose();
    } catch (submitError) {
      if (
        submitError instanceof Error &&
        submitError.message.includes(
          "PUBLIC_VISIBILITY_ACKNOWLEDGEMENT_REQUIRED",
        )
      ) {
        setRequiresVisibilityAcknowledgement(true);
        setError(null);
        return;
      }
      setError(t`Use a valid Google Drive, Docs, Sheets or Slides file link.`);
    }
  };

  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-[150]" onClose={onClose}>
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
              enterFrom="translate-y-4 opacity-0 sm:scale-95"
              enterTo="translate-y-0 opacity-100 sm:scale-100"
              leave="ease-in duration-150"
              leaveFrom="translate-y-0 opacity-100 sm:scale-100"
              leaveTo="translate-y-4 opacity-0 sm:scale-95"
            >
              <Dialog.Panel className="w-full max-w-md rounded-lg border border-light-300 bg-light-50 shadow-xl dark:border-dark-400 dark:bg-dark-100">
                <div className="flex items-center justify-between border-b border-light-300 px-5 py-4 dark:border-dark-400">
                  <div className="flex items-center gap-2">
                    <HiLink className="h-4 w-4 text-light-800 dark:text-dark-800" />
                    <Dialog.Title className="text-sm font-semibold text-light-1000 dark:text-dark-1000">{t`Add a Drive document`}</Dialog.Title>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-light-800 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:text-dark-800 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
                    aria-label={t`Close`}
                  >
                    <HiXMark className="h-5 w-5" />
                  </button>
                </div>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submit();
                  }}
                  className="space-y-4 p-5"
                >
                  {requiresVisibilityAcknowledgement && (
                    <div
                      role="alert"
                      className="rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
                    >
                      <p className="font-semibold">{t`This board is now public`}</p>
                      <p className="mt-1">{t`Anyone with access to the public board can preview this Drive reference.`}</p>
                      <button
                        type="button"
                        onClick={() => {
                          onVisibilityAcknowledged?.();
                          void submit(true);
                        }}
                        className="mt-2 rounded-md border border-amber-500 px-2.5 py-1.5 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700"
                      >{t`I understand, add it`}</button>
                    </div>
                  )}
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-light-900 dark:text-dark-900">{t`Google Drive link`}</span>
                    <input
                      autoFocus
                      type="url"
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                      placeholder="https://docs.google.com/document/d/…"
                      aria-invalid={!!error}
                      aria-describedby={error ? "drive-link-error" : undefined}
                      className="w-full rounded-md border border-light-400 bg-light-50 px-3 py-2 text-sm text-light-1000 placeholder:text-light-600 focus:border-light-800 focus:ring-light-800 dark:border-dark-500 dark:bg-dark-200 dark:text-dark-1000 dark:placeholder:text-dark-600 dark:focus:border-dark-800 dark:focus:ring-dark-800"
                    />
                    {error && (
                      <p
                        id="drive-link-error"
                        role="alert"
                        className="mt-1.5 text-xs text-red-600 dark:text-red-400"
                      >
                        {error}
                      </p>
                    )}
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-light-900 dark:text-dark-900">{t`Display title (optional)`}</span>
                    <input
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      maxLength={255}
                      placeholder={t`For example: Course outline`}
                      className="w-full rounded-md border border-light-400 bg-light-50 px-3 py-2 text-sm text-light-1000 placeholder:text-light-600 focus:border-light-800 focus:ring-light-800 dark:border-dark-500 dark:bg-dark-200 dark:text-dark-1000 dark:placeholder:text-dark-600 dark:focus:border-dark-800 dark:focus:ring-dark-800"
                    />
                  </label>
                  <p className="text-xs leading-5 text-light-700 dark:text-dark-700">{t`Kan respects the document's Drive permissions and never changes them.`}</p>
                  <div className="flex justify-end gap-2 pt-1">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={onClose}
                    >{t`Cancel`}</Button>
                    {!requiresVisibilityAcknowledgement && (
                      <Button
                        type="submit"
                        isLoading={createDriveLink.isPending}
                        disabled={!url.trim()}
                      >{t`Add link`}</Button>
                    )}
                  </div>
                </form>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
