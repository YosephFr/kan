import Image from "next/image";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { t } from "@lingui/core/macro";
import { HiOutlinePhoto, HiXMark } from "react-icons/hi2";

import type { UploadCardResource } from "./card-resource-types";
import Button from "~/components/Button";

export function CardVisualWallResourceDialog({
  open,
  resources,
  existingPreviews,
  busy,
  onClose,
  onAdd,
}: {
  open: boolean;
  resources: UploadCardResource[];
  existingPreviews?: Readonly<
    Record<
      string,
      {
        viewUrl: string;
        widthPx: number | null;
        heightPx: number | null;
      }
    >
  >;
  busy: boolean;
  onClose: () => void;
  onAdd: (resource: UploadCardResource) => void | Promise<void>;
}) {
  return (
    <Dialog
      open={open}
      onClose={busy ? () => undefined : onClose}
      className="relative z-50"
    >
      <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="flex max-h-[min(42rem,calc(100dvh-2rem))] w-full max-w-3xl flex-col rounded-lg border border-light-400 bg-light-50 shadow-2xl dark:border-dark-500 dark:bg-dark-100">
          <div className="flex min-h-14 items-center justify-between border-b border-light-300 px-4 dark:border-dark-400 sm:px-5">
            <div className="min-w-0">
              <DialogTitle className="text-base font-semibold text-light-1000 dark:text-dark-1000">
                {t`Add from resources`}
              </DialogTitle>
              <p className="mt-0.5 text-xs text-light-700 dark:text-dark-700">
                {t`Choose an image already stored safely on this card.`}
              </p>
            </div>
            <button
              type="button"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-light-800 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:text-dark-800 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
              onClick={onClose}
              disabled={busy}
              aria-label={t`Close`}
            >
              <HiXMark className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
            {resources.length === 0 ? (
              <div className="flex min-h-56 items-center justify-center px-6 text-center">
                <div>
                  <HiOutlinePhoto className="mx-auto h-8 w-8 text-light-600 dark:text-dark-600" />
                  <p className="mt-3 text-sm font-medium text-light-1000 dark:text-dark-1000">
                    {t`No images in Resources`}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-light-700 dark:text-dark-700">
                    {t`Upload an image to this card, then add it to the visual wall.`}
                  </p>
                </div>
              </div>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {resources.map((resource) => (
                  <li key={resource.publicId} className="min-w-0">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void onAdd(resource)}
                      className="group w-full overflow-hidden border border-light-300 bg-light-100 text-left hover:border-light-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 disabled:opacity-50 dark:border-dark-400 dark:bg-dark-200 dark:hover:border-dark-700 dark:focus-visible:ring-dark-800"
                    >
                      <span className="relative block aspect-[4/3] overflow-hidden">
                        {resource.viewUrl && (
                          <Image
                            src={
                              existingPreviews?.[resource.publicId]?.viewUrl ??
                              resource.viewUrl
                            }
                            alt=""
                            fill
                            sizes="(max-width: 640px) 50vw, 220px"
                            unoptimized
                            loading="lazy"
                            decoding="async"
                            className="object-contain"
                          />
                        )}
                      </span>
                      <span className="block truncate px-3 py-2 text-xs font-medium text-light-1000 dark:text-dark-1000">
                        {resource.title}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex justify-end border-t border-light-300 px-4 py-3 dark:border-dark-400 sm:px-5">
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              onClick={onClose}
              disabled={busy}
            >
              {t`Cancel`}
            </Button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
