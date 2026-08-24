import Image from "next/image";
import { Dialog, Transition } from "@headlessui/react";
import { t } from "@lingui/core/macro";
import { Fragment } from "react";
import {
  HiArrowDownTray,
  HiArrowTopRightOnSquare,
  HiOutlineDocumentText,
  HiXMark,
} from "react-icons/hi2";

import type { CardResource } from "./card-resource-types";
import Button from "~/components/Button";
import {
  CARD_RESOURCE_DRIVE_SANDBOX,
  CARD_RESOURCE_REFERRER_POLICY,
  getCardResourcePreviewKind,
} from "./card-resource-preview";
import { CardPdfViewer } from "./CardPdfPreview";

interface CardResourceViewerProps {
  resource: CardResource | null;
  onClose: () => void;
}

interface CardResourcePreviewBodyProps {
  resource: CardResource;
}

interface CardResourceInlinePreviewProps extends CardResourceViewerProps {
  id?: string;
}

function ResourceAction({ resource }: { resource: CardResource }) {
  return resource.kind === "upload" ? (
    <a
      href={resource.downloadUrl}
      className="flex h-8 w-8 items-center justify-center rounded-md text-light-800 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:text-dark-800 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
      aria-label={t`Download ${resource.title}`}
    >
      <HiArrowDownTray className="h-4 w-4" />
    </a>
  ) : (
    <a
      href={resource.openUrl}
      target="_blank"
      rel="noopener noreferrer"
      referrerPolicy={CARD_RESOURCE_REFERRER_POLICY}
      className="flex h-8 w-8 items-center justify-center rounded-md text-light-800 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:text-dark-800 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
      aria-label={t`Open ${resource.title} in Drive`}
    >
      <HiArrowTopRightOnSquare className="h-4 w-4" />
    </a>
  );
}

export function CardResourcePreviewBody({
  resource,
}: CardResourcePreviewBodyProps) {
  const previewKind = getCardResourcePreviewKind(resource);

  if (
    previewKind === "image" &&
    resource.kind === "upload" &&
    resource.viewUrl
  ) {
    return (
      <div className="relative h-full min-h-80 w-full bg-light-100 dark:bg-dark-50">
        <Image
          src={resource.viewUrl}
          alt={resource.title}
          fill
          sizes="100vw"
          unoptimized
          className="object-contain p-3 sm:p-6"
        />
      </div>
    );
  }

  if (previewKind === "pdf" && resource.kind === "upload" && resource.viewUrl) {
    return <CardPdfViewer url={resource.viewUrl} title={resource.title} />;
  }

  if (resource.kind === "drive") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <iframe
          src={resource.previewUrl}
          title={resource.title}
          sandbox={CARD_RESOURCE_DRIVE_SANDBOX}
          referrerPolicy={CARD_RESOURCE_REFERRER_POLICY}
          loading="lazy"
          className="min-h-0 flex-1 border-0 bg-white"
        />
        <div className="border-t border-light-300 p-3 text-center dark:border-dark-400">
          <a
            href={resource.openUrl}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy={CARD_RESOURCE_REFERRER_POLICY}
            className="text-xs font-medium text-blue-700 underline-offset-2 hover:underline dark:text-blue-400"
          >{t`If the preview is unavailable, open it in Drive`}</a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-80 items-center justify-center p-8 text-center">
      <div>
        <HiOutlineDocumentText className="mx-auto h-10 w-10 text-light-600 dark:text-dark-600" />
        <p className="mt-3 text-sm font-medium text-light-1000 dark:text-dark-1000">{t`This file is available to download`}</p>
        <p className="mt-1 text-xs text-light-700 dark:text-dark-700">{t`Office documents are not converted or embedded.`}</p>
        <Button
          href={resource.downloadUrl}
          variant="secondary"
          size="sm"
          iconLeft={<HiArrowDownTray className="h-4 w-4" />}
          className="mt-4"
        >{t`Download file`}</Button>
      </div>
    </div>
  );
}

export function CardResourceInlinePreview({
  resource,
  onClose,
  id = "card-resource-inline-preview",
}: CardResourceInlinePreviewProps) {
  if (!resource) return null;

  return (
    <section
      id={id}
      aria-label={t`Preview ${resource.title}`}
      className="mt-5 overflow-hidden rounded-lg border border-light-300 bg-light-50 dark:border-dark-400 dark:bg-dark-100"
    >
      <div className="flex items-center justify-between gap-3 border-b border-light-300 px-4 py-3 dark:border-dark-400">
        <h4 className="min-w-0 truncate text-sm font-semibold text-light-1000 dark:text-dark-1000">
          {resource.title}
        </h4>
        <div className="flex shrink-0 items-center gap-1">
          <ResourceAction resource={resource} />
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-light-800 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:text-dark-800 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
            aria-label={t`Close preview`}
          >
            <HiXMark className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div className="h-[min(42rem,68dvh)] min-h-80">
        <CardResourcePreviewBody resource={resource} />
      </div>
    </section>
  );
}

export function CardResourceViewer({
  resource,
  onClose,
}: CardResourceViewerProps) {
  return (
    <Transition.Root show={resource !== null} as={Fragment}>
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
          <div className="fixed inset-0 bg-black/40" />
        </Transition.Child>
        <div className="fixed inset-0 overflow-hidden p-0 sm:p-4">
          <div className="flex h-full items-end justify-center sm:items-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="translate-y-6 opacity-0 sm:scale-95"
              enterTo="translate-y-0 opacity-100 sm:scale-100"
              leave="ease-in duration-150"
              leaveFrom="translate-y-0 opacity-100 sm:scale-100"
              leaveTo="translate-y-6 opacity-0 sm:scale-95"
            >
              <Dialog.Panel className="flex h-[calc(100dvh-1rem)] w-full max-w-6xl flex-col overflow-hidden rounded-t-xl border border-light-300 bg-light-50 shadow-xl dark:border-dark-400 dark:bg-dark-100 sm:h-[min(52rem,calc(100dvh-2rem))] sm:rounded-lg">
                {resource && (
                  <>
                    <div className="flex items-center justify-between gap-3 border-b border-light-300 px-4 py-3 dark:border-dark-400 sm:px-5">
                      <Dialog.Title className="min-w-0 truncate text-sm font-semibold text-light-1000 dark:text-dark-1000">
                        {resource.title}
                      </Dialog.Title>
                      <div className="flex shrink-0 items-center gap-1">
                        <ResourceAction resource={resource} />
                        <button
                          type="button"
                          onClick={onClose}
                          className="flex h-8 w-8 items-center justify-center rounded-md text-light-800 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:text-dark-800 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
                          aria-label={t`Close preview`}
                        >
                          <HiXMark className="h-5 w-5" />
                        </button>
                      </div>
                    </div>
                    <div className="min-h-0 flex-1">
                      <CardResourcePreviewBody resource={resource} />
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
