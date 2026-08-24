import { Dialog, Transition } from "@headlessui/react";
import { t } from "@lingui/core/macro";
import { Fragment, useEffect, useState } from "react";
import { HiLink, HiXMark } from "react-icons/hi2";

import type { WebCardResource } from "./card-resource-types";
import Button from "~/components/Button";
import { usePopup } from "~/providers/popup";
import {
  isWebLinkLimitError,
  isWebLinkVisibilityAcknowledgementError,
  normalizeCardWebLink,
} from "./card-web-link";
import { useCreateCardWebLink } from "./use-card-web-link";

interface CardWebLinkDialogProps {
  cardPublicId: string;
  isOpen: boolean;
  initialUrl?: string;
  publicVisibilityAcknowledged?: boolean;
  onVisibilityAcknowledged?: () => void;
  onCreated?: (resource: WebCardResource) => Promise<void> | void;
  onClose: () => void;
}

export function CardWebLinkDialog({
  cardPublicId,
  isOpen,
  initialUrl = "",
  publicVisibilityAcknowledged,
  onVisibilityAcknowledged,
  onCreated,
  onClose,
}: CardWebLinkDialogProps) {
  const { showPopup } = usePopup();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [
    requiresVisibilityAcknowledgement,
    setRequiresVisibilityAcknowledgement,
  ] = useState(false);
  const { createWebLink, isPending } = useCreateCardWebLink(cardPublicId);

  useEffect(() => {
    if (!isOpen) return;
    setUrl(initialUrl);
    setError(null);
    setRequiresVisibilityAcknowledgement(false);
  }, [initialUrl, isOpen]);

  const submit = async (acknowledgeVisibility = false) => {
    const normalizedUrl = normalizeCardWebLink(url);
    if (!normalizedUrl) {
      setError(t`Enter one valid HTTPS link without credentials.`);
      return;
    }
    setError(null);
    try {
      const resource = await createWebLink(
        normalizedUrl,
        acknowledgeVisibility || publicVisibilityAcknowledged,
      );
      await onCreated?.(resource);
      showPopup({
        header: t`Link added`,
        message: t`The link is now available from this card.`,
        icon: "success",
      });
      onClose();
    } catch (submitError) {
      if (isWebLinkVisibilityAcknowledgementError(submitError)) {
        setRequiresVisibilityAcknowledgement(true);
        return;
      }
      setError(
        isWebLinkLimitError(submitError)
          ? t`This card already has 100 web links.`
          : t`The link could not be added. Check it and try again.`,
      );
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
                    <Dialog.Title className="text-sm font-semibold text-light-1000 dark:text-dark-1000">
                      {t`Add a web link`}
                    </Dialog.Title>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={isPending}
                    className="flex h-11 w-11 items-center justify-center rounded-md text-light-800 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 disabled:opacity-50 dark:text-dark-800 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
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
                      <p className="font-semibold">{t`This board is public`}</p>
                      <p className="mt-1">
                        {t`Anyone with access to the public board can see this preview and open the link.`}
                      </p>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => {
                          onVisibilityAcknowledged?.();
                          void submit(true);
                        }}
                        className="mt-2 min-h-11 rounded-md border border-amber-500 px-3 py-2 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 disabled:opacity-50"
                      >
                        {t`I understand, add it`}
                      </button>
                    </div>
                  )}
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-light-900 dark:text-dark-900">
                      {t`HTTPS link`}
                    </span>
                    <input
                      autoFocus
                      type="url"
                      inputMode="url"
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={2048}
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                      placeholder="https://example.com/idea"
                      aria-invalid={!!error}
                      aria-describedby={
                        error ? "web-link-error" : "web-link-help"
                      }
                      className="h-11 w-full rounded-md border border-light-400 bg-light-50 px-3 text-sm text-light-1000 placeholder:text-light-600 focus:border-light-800 focus:ring-light-800 dark:border-dark-500 dark:bg-dark-200 dark:text-dark-1000 dark:placeholder:text-dark-600 dark:focus:border-dark-800 dark:focus:ring-dark-800"
                    />
                    {error ? (
                      <p
                        id="web-link-error"
                        role="alert"
                        className="mt-1.5 text-xs text-red-600 dark:text-red-400"
                      >
                        {error}
                      </p>
                    ) : (
                      <p
                        id="web-link-help"
                        className="mt-1.5 text-xs leading-5 text-light-700 dark:text-dark-700"
                      >
                        {t`Kan creates a safe visual preview. The website is never embedded in the whiteboard.`}
                      </p>
                    )}
                  </label>
                  <div className="flex justify-end gap-2 pt-1">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={isPending}
                      onClick={onClose}
                    >
                      {t`Cancel`}
                    </Button>
                    {!requiresVisibilityAcknowledgement && (
                      <Button
                        type="submit"
                        isLoading={isPending}
                        disabled={!url.trim()}
                      >
                        {t`Add link`}
                      </Button>
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
