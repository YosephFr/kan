import { t } from "@lingui/core/macro";
import { useEffect, useMemo, useState } from "react";
import {
  HiArrowTopRightOnSquare,
  HiLink,
  HiOutlineDocumentText,
  HiOutlinePhoto,
  HiXMark,
} from "react-icons/hi2";

import type { CardSubtask } from "./subtask-types";
import Button from "~/components/Button";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";

interface SubtaskResourceSectionProps {
  cardPublicId: string;
  subtaskPublicId: string;
  resources: CardSubtask["resources"];
  canEdit: boolean;
  onOpenResource: (resourcePublicId: string) => void;
}

export function SubtaskResourceSection({
  cardPublicId,
  subtaskPublicId,
  resources,
  canEdit,
  onOpenResource,
}: SubtaskResourceSectionProps) {
  const utils = api.useUtils();
  const { showPopup } = usePopup();
  const [selectedResourcePublicId, setSelectedResourcePublicId] = useState("");
  const resourceQuery = api.cardResource.list.useQuery(
    { cardPublicId },
    { enabled: cardPublicId.length >= 12, retry: 1 },
  );
  const linkResource = api.cardSubtask.linkResource.useMutation();
  const unlinkResource = api.cardSubtask.unlinkResource.useMutation();

  const linkedResourceIds = useMemo(
    () => new Set(resources.map((resource) => resource.publicId)),
    [resources],
  );
  const availableResources = (resourceQuery.data?.resources ?? []).filter(
    (resource) => !linkedResourceIds.has(resource.publicId),
  );

  useEffect(() => {
    if (
      selectedResourcePublicId &&
      !availableResources.some(
        (resource) => resource.publicId === selectedResourcePublicId,
      )
    ) {
      setSelectedResourcePublicId("");
    }
  }, [availableResources, selectedResourcePublicId]);

  const refresh = async () => {
    await Promise.all([
      utils.cardPipeline.get.invalidate({ cardPublicId }),
      utils.card.byId.invalidate({ cardPublicId }),
      utils.cardResource.list.invalidate({ cardPublicId }),
    ]);
  };

  const handleLink = async () => {
    if (!selectedResourcePublicId) return;
    try {
      await linkResource.mutateAsync({
        subtaskPublicId,
        resourcePublicId: selectedResourcePublicId,
      });
      setSelectedResourcePublicId("");
      await refresh();
    } catch {
      showPopup({
        header: t`Unable to link resource`,
        message: t`Please try again. The resource is still safe.`,
        icon: "error",
      });
    }
  };

  const handleUnlink = async (resourcePublicId: string) => {
    try {
      await unlinkResource.mutateAsync({
        subtaskPublicId,
        resourcePublicId,
      });
      await refresh();
    } catch {
      showPopup({
        header: t`Unable to unlink resource`,
        message: t`Please try again. The resource remains linked.`,
        icon: "error",
      });
    }
  };

  const isMutating = linkResource.isPending || unlinkResource.isPending;

  return (
    <div className="mt-7 border-t border-light-300 pt-6 dark:border-dark-400">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium text-light-1000 dark:text-dark-1000">
          {t`Resources`}
        </h3>
        <span className="text-xs tabular-nums text-light-700 dark:text-dark-700">
          {resources.length}
        </span>
      </div>

      {resources.length > 0 ? (
        <div className="mt-3 divide-y divide-light-300 border-y border-light-300 dark:divide-dark-400 dark:border-dark-400">
          {resources.map((resource) => (
            <div
              key={resource.publicId}
              className="group flex min-w-0 items-center gap-3 py-2.5"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-light-200 text-light-800 dark:bg-dark-200 dark:text-dark-800">
                {resource.kind === "upload" &&
                resource.contentType.startsWith("image/") ? (
                  <HiOutlinePhoto className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <HiOutlineDocumentText
                    className="h-4 w-4"
                    aria-hidden="true"
                  />
                )}
              </span>
              <button
                type="button"
                onClick={() => onOpenResource(resource.publicId)}
                className="min-w-0 flex-1 truncate text-left text-xs font-medium text-light-950 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:text-dark-950 dark:focus-visible:ring-dark-800"
              >
                {resource.title}
              </button>
              <HiArrowTopRightOnSquare
                className="h-4 w-4 shrink-0 text-light-600 dark:text-dark-600"
                aria-hidden="true"
              />
              {canEdit && (
                <button
                  type="button"
                  onClick={() => void handleUnlink(resource.publicId)}
                  disabled={isMutating}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-light-700 hover:bg-light-200 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 disabled:opacity-50 dark:text-dark-700 dark:hover:bg-dark-200 dark:hover:text-red-400 dark:focus-visible:ring-dark-800 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                  aria-label={t`Unlink ${resource.title}`}
                >
                  <HiXMark className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs leading-5 text-light-700 dark:text-dark-700">
          {t`No resources are linked to this subtask.`}
        </p>
      )}

      {canEdit && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <label className="sr-only" htmlFor={`resource-${subtaskPublicId}`}>
            {t`Card resource`}
          </label>
          <select
            id={`resource-${subtaskPublicId}`}
            value={selectedResourcePublicId}
            onChange={(event) =>
              setSelectedResourcePublicId(event.target.value)
            }
            disabled={resourceQuery.isLoading || isMutating}
            className="min-w-0 flex-1 rounded-md border border-light-400 bg-light-50 px-2.5 py-2 text-xs text-light-950 focus:border-light-800 focus:ring-light-800 disabled:opacity-60 dark:border-dark-500 dark:bg-dark-200 dark:text-dark-950 dark:focus:border-dark-800 dark:focus:ring-dark-800"
          >
            <option value="">
              {resourceQuery.isLoading
                ? t`Loading card resources…`
                : availableResources.length > 0
                  ? t`Choose a card resource`
                  : t`No other card resources`}
            </option>
            {availableResources.map((resource) => (
              <option key={resource.publicId} value={resource.publicId}>
                {resource.title}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            iconLeft={<HiLink className="h-4 w-4" />}
            disabled={!selectedResourcePublicId || isMutating}
            isLoading={linkResource.isPending}
            onClick={() => void handleLink()}
          >
            {t`Link`}
          </Button>
        </div>
      )}

      {resourceQuery.isError && (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
          {t`Card resources could not be loaded.`}
        </p>
      )}
    </div>
  );
}
