import Image from "next/image";
import { useRouter } from "next/router";
import { Dialog, Transition } from "@headlessui/react";
import { t } from "@lingui/core/macro";
import { Fragment, useEffect, useState } from "react";
import {
  HiArrowDownTray,
  HiArrowPath,
  HiLink,
  HiOutlineDocumentText,
  HiOutlineExclamationTriangle,
  HiOutlineFolderOpen,
  HiOutlinePhoto,
  HiOutlinePresentationChartBar,
  HiOutlineTableCells,
  HiOutlineTrash,
  HiOutlineVariable,
  HiPlusSmall,
} from "react-icons/hi2";

import type { CardResource } from "./card-resource-types";
import Button from "~/components/Button";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import { invalidateCard } from "~/utils/cardInvalidation";
import { CardDriveLinkDialog } from "./CardDriveLinkDialog";
import { CardPdfThumbnail } from "./CardPdfPreview";
import { CardResourceUploadQueue } from "./CardResourceUploadQueue";
import { CardResourceViewer } from "./CardResourceViewer";
import { formatResourceSize } from "./resource-upload-queue";

interface CardFilesViewProps {
  cardPublicId: string;
  canEdit: boolean;
  isPublicBoard: boolean;
  compact?: boolean;
}

const isResourceInUseError = (error: unknown) =>
  error instanceof Error && error.message.includes("RESOURCE_IN_USE");

function getDriveTypeLabel(resource: Extract<CardResource, { kind: "drive" }>) {
  if (resource.driveType === "document") return t`Google Docs`;
  if (resource.driveType === "spreadsheet") return t`Google Sheets`;
  if (resource.driveType === "presentation") return t`Google Slides`;
  return t`Google Drive file`;
}

function ResourceTypeIcon({ resource }: { resource: CardResource }) {
  if (resource.kind === "drive") {
    if (resource.driveType === "spreadsheet") {
      return <HiOutlineTableCells className="h-7 w-7" />;
    }
    if (resource.driveType === "presentation") {
      return <HiOutlinePresentationChartBar className="h-7 w-7" />;
    }
    if (resource.driveType === "document") {
      return <HiOutlineDocumentText className="h-7 w-7" />;
    }
    return <HiOutlineVariable className="h-7 w-7" />;
  }
  if (resource.contentType.startsWith("image/")) {
    return <HiOutlinePhoto className="h-7 w-7" />;
  }
  return <HiOutlineDocumentText className="h-7 w-7" />;
}

function ResourceCard({
  resource,
  canEdit,
  onOpen,
  onDelete,
}: {
  resource: CardResource;
  canEdit: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const imageUrl =
    resource.kind === "upload" &&
    resource.contentType.startsWith("image/") &&
    resource.viewUrl
      ? resource.viewUrl
      : null;
  const pdfUrl =
    resource.kind === "upload" &&
    resource.contentType === "application/pdf" &&
    resource.viewUrl
      ? resource.viewUrl
      : null;

  return (
    <article className="group min-w-0 overflow-hidden rounded-lg border border-light-300 bg-light-50 transition-colors hover:border-light-500 dark:border-dark-400 dark:bg-dark-100 dark:hover:border-dark-600">
      <button
        type="button"
        onClick={onOpen}
        className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-light-800 dark:focus-visible:ring-dark-800"
      >
        {imageUrl ? (
          <div className="relative h-40 bg-light-100 dark:bg-dark-50">
            <Image
              src={imageUrl}
              alt=""
              fill
              sizes="(max-width: 640px) 100vw, 300px"
              unoptimized
              className="object-cover"
            />
          </div>
        ) : pdfUrl ? (
          <CardPdfThumbnail url={pdfUrl} />
        ) : (
          <div className="flex h-40 items-center justify-center bg-light-100 text-light-600 dark:bg-dark-50 dark:text-dark-600">
            <ResourceTypeIcon resource={resource} />
          </div>
        )}
        <div className="px-3 py-3">
          <p className="truncate text-sm font-medium text-light-1000 dark:text-dark-1000">
            {resource.title}
          </p>
          <p className="mt-1 truncate text-[11px] text-light-700 dark:text-dark-700">
            {resource.kind === "drive"
              ? getDriveTypeLabel(resource)
              : `${formatResourceSize(resource.size)} · ${resource.contentType}`}
          </p>
        </div>
      </button>
      <div className="flex items-center justify-between border-t border-light-300 px-2 py-1.5 dark:border-dark-400">
        {resource.kind === "upload" ? (
          <a
            href={resource.downloadUrl}
            className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-light-800 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:text-dark-800 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
          >
            <HiArrowDownTray className="h-3.5 w-3.5" />
            {t`Download`}
          </a>
        ) : (
          <a
            href={resource.openUrl}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
            className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-light-800 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:text-dark-800 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
          >
            <HiLink className="h-3.5 w-3.5" />
            {t`Open in Drive`}
          </a>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={onDelete}
            className="flex h-8 w-8 items-center justify-center rounded-md text-light-600 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:text-dark-600 dark:hover:bg-red-950/30 dark:hover:text-red-400 dark:focus-visible:ring-dark-800 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
            aria-label={t`Delete ${resource.title}`}
          >
            <HiOutlineTrash className="h-4 w-4" />
          </button>
        )}
      </div>
    </article>
  );
}

export function CardFilesView({
  cardPublicId,
  canEdit,
  isPublicBoard,
  compact = false,
}: CardFilesViewProps) {
  const router = useRouter();
  const utils = api.useUtils();
  const { showPopup } = usePopup();
  const [isDriveDialogOpen, setIsDriveDialogOpen] = useState(false);
  const [acknowledgedPublicVisibility, setAcknowledgedPublicVisibility] =
    useState(false);
  const [serverRequiresAcknowledgement, setServerRequiresAcknowledgement] =
    useState(false);
  const [selectedResourcePublicId, setSelectedResourcePublicId] = useState<
    string | null
  >(null);
  const [resourceToDelete, setResourceToDelete] = useState<CardResource | null>(
    null,
  );
  const [deleteMustUnlink, setDeleteMustUnlink] = useState(false);
  const resourceQuery = api.cardResource.list.useQuery(
    { cardPublicId },
    { enabled: cardPublicId.length >= 12, retry: 1 },
  );
  const deleteResource = api.cardResource.delete.useMutation();
  const routerResourcePublicId = Array.isArray(router.query.recurso)
    ? router.query.recurso[0]
    : router.query.recurso;

  useEffect(() => {
    setSelectedResourcePublicId(routerResourcePublicId ?? null);
  }, [routerResourcePublicId]);

  const resources = resourceQuery.data?.resources ?? [];
  const selectedResource =
    resources.find(
      (resource) => resource.publicId === selectedResourcePublicId,
    ) ?? null;
  const needsVisibilityAcknowledgement =
    isPublicBoard || serverRequiresAcknowledgement;
  const mutationAcknowledgement =
    needsVisibilityAcknowledgement && acknowledgedPublicVisibility
      ? true
      : undefined;
  const controlsDisabled =
    !canEdit ||
    (needsVisibilityAcknowledgement && !acknowledgedPublicVisibility);

  const setResourceInUrl = (resourcePublicId: string | null) => {
    const nextQuery = { ...router.query };
    if (resourcePublicId) nextQuery.recurso = resourcePublicId;
    else delete nextQuery.recurso;
    void router.replace(
      { pathname: router.pathname, query: nextQuery },
      undefined,
      { shallow: true },
    );
    setSelectedResourcePublicId(resourcePublicId);
  };

  const confirmDelete = async () => {
    if (!resourceToDelete) return;
    try {
      await deleteResource.mutateAsync({
        resourcePublicId: resourceToDelete.publicId,
        removeReferences: deleteMustUnlink ? "true" : undefined,
      });
      if (selectedResourcePublicId === resourceToDelete.publicId) {
        setResourceInUrl(null);
      }
      setResourceToDelete(null);
      setDeleteMustUnlink(false);
      await Promise.all([
        resourceQuery.refetch(),
        invalidateCard(utils, cardPublicId),
        utils.cardPipeline.get.invalidate({ cardPublicId }),
        utils.board.byId.invalidate(),
      ]);
      showPopup({
        header: t`Resource deleted`,
        message: t`The resource was removed from this card.`,
        icon: "success",
      });
    } catch (error) {
      if (isResourceInUseError(error)) {
        setDeleteMustUnlink(true);
        return;
      }
      showPopup({
        header: t`Unable to delete resource`,
        message: t`Please try again. Your resource is still safe.`,
        icon: "error",
      });
    }
  };

  return (
    <section
      id="card-view-files"
      role="tabpanel"
      aria-labelledby="card-tab-files"
      className="h-full overflow-y-auto"
    >
      <div
        className={
          compact ? "p-1" : "mx-auto w-full max-w-6xl p-4 md:p-6 lg:p-8"
        }
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-light-1000 dark:text-dark-1000">{t`Files and references`}</h2>
            <p className="mt-1 text-xs leading-5 text-light-700 dark:text-dark-700">{t`Keep source material, documents and visual references with the work.`}</p>
          </div>
          {canEdit && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              iconLeft={<HiPlusSmall className="h-4 w-4" />}
              disabled={controlsDisabled}
              onClick={() => setIsDriveDialogOpen(true)}
            >
              {t`Add Drive link`}
            </Button>
          )}
        </div>

        {canEdit && needsVisibilityAcknowledgement && (
          <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/30">
            <input
              type="checkbox"
              checked={acknowledgedPublicVisibility}
              onChange={(event) =>
                setAcknowledgedPublicVisibility(event.target.checked)
              }
              className="mt-0.5 h-4 w-4 rounded border-amber-500 text-amber-700 focus:ring-amber-600"
            />
            <span>
              <span className="block text-xs font-semibold text-amber-950 dark:text-amber-200">{t`This board is public`}</span>
              <span className="mt-0.5 block text-xs leading-5 text-amber-900 dark:text-amber-300">{t`Anyone with access to the public board can preview these resources. I understand and want to continue.`}</span>
            </span>
          </label>
        )}

        {canEdit && (
          <div className="mt-5">
            <CardResourceUploadQueue
              cardPublicId={cardPublicId}
              disabled={controlsDisabled}
              publicVisibilityAcknowledged={mutationAcknowledgement}
              onVisibilityAcknowledgementRequired={() => {
                setServerRequiresAcknowledgement(true);
                setAcknowledgedPublicVisibility(false);
              }}
            />
          </div>
        )}

        <div className="mt-7 flex items-baseline justify-between border-b border-light-300 pb-3 dark:border-dark-400">
          <h3 className="text-sm font-medium text-light-1000 dark:text-dark-1000">{t`Card resources`}</h3>
          <span className="text-xs tabular-nums text-light-700 dark:text-dark-700">
            {resourceQuery.data?.summary.total ?? 0}
          </span>
        </div>

        {resourceQuery.isLoading && (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((item) => (
              <div
                key={item}
                className="h-56 animate-pulse rounded-lg bg-light-200 dark:bg-dark-200"
              />
            ))}
          </div>
        )}
        {resourceQuery.isError && (
          <div className="flex min-h-64 items-center justify-center p-6 text-center">
            <div>
              <HiOutlineExclamationTriangle className="mx-auto h-7 w-7 text-red-600 dark:text-red-400" />
              <p className="mt-3 text-sm font-medium text-light-1000 dark:text-dark-1000">{t`Resources could not be loaded`}</p>
              <button
                type="button"
                onClick={() => void resourceQuery.refetch()}
                className="mt-3 inline-flex items-center gap-2 rounded-md border border-light-500 px-3 py-2 text-xs font-medium text-light-900 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:border-dark-500 dark:text-dark-900 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
              >
                <HiArrowPath className="h-4 w-4" />
                {t`Try again`}
              </button>
            </div>
          </div>
        )}
        {!resourceQuery.isLoading &&
          !resourceQuery.isError &&
          resources.length === 0 && (
            <div className="flex min-h-64 items-center justify-center p-6 text-center">
              <div className="max-w-sm">
                <HiOutlineFolderOpen className="mx-auto h-8 w-8 text-light-600 dark:text-dark-600" />
                <p className="mt-3 text-sm font-medium text-light-1000 dark:text-dark-1000">{t`No resources yet`}</p>
                <p className="mt-1 text-xs leading-5 text-light-700 dark:text-dark-700">
                  {canEdit
                    ? t`Upload source files or add a Drive document to start developing this card.`
                    : t`Files and references will appear here when they are added.`}
                </p>
              </div>
            </div>
          )}
        {resources.length > 0 && (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {resources.map((resource) => (
              <ResourceCard
                key={resource.publicId}
                resource={resource}
                canEdit={canEdit}
                onOpen={() => setResourceInUrl(resource.publicId)}
                onDelete={() => {
                  setDeleteMustUnlink(false);
                  setResourceToDelete(resource);
                }}
              />
            ))}
          </div>
        )}
      </div>

      <CardDriveLinkDialog
        cardPublicId={cardPublicId}
        isOpen={isDriveDialogOpen}
        publicVisibilityAcknowledged={mutationAcknowledgement}
        onVisibilityAcknowledged={() => {
          setServerRequiresAcknowledgement(true);
          setAcknowledgedPublicVisibility(true);
        }}
        onClose={() => setIsDriveDialogOpen(false)}
      />
      <CardResourceViewer
        resource={selectedResource}
        onClose={() => setResourceInUrl(null)}
      />

      <Transition.Root show={resourceToDelete !== null} as={Fragment}>
        <Dialog
          as="div"
          className="relative z-[160]"
          onClose={() => {
            if (!deleteResource.isPending) setResourceToDelete(null);
          }}
        >
          <div className="fixed inset-0 bg-black/30" />
          <div className="fixed inset-0 overflow-y-auto p-4">
            <div className="flex min-h-full items-center justify-center">
              <Dialog.Panel className="w-full max-w-sm rounded-lg border border-light-300 bg-light-50 p-5 shadow-xl dark:border-dark-400 dark:bg-dark-100">
                <Dialog.Title className="text-sm font-semibold text-light-1000 dark:text-dark-1000">
                  {deleteMustUnlink
                    ? t`Resource is in use`
                    : t`Delete this resource?`}
                </Dialog.Title>
                <p className="mt-2 text-xs leading-5 text-light-700 dark:text-dark-700">
                  {deleteMustUnlink
                    ? t`This resource is linked to one or more subtasks. Deleting it will also remove those links.`
                    : t`The resource will be removed from this card. Uploaded files cannot be recovered here.`}
                </p>
                <div className="mt-5 flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setResourceToDelete(null)}
                  >{t`Cancel`}</Button>
                  <Button
                    type="button"
                    variant="danger"
                    isLoading={deleteResource.isPending}
                    onClick={() => void confirmDelete()}
                  >
                    {deleteMustUnlink ? t`Delete and unlink` : t`Delete`}
                  </Button>
                </div>
              </Dialog.Panel>
            </div>
          </div>
        </Dialog>
      </Transition.Root>
    </section>
  );
}
