import { useRouter } from "next/router";
import { Dialog } from "@headlessui/react";
import { t } from "@lingui/core/macro";
import { useEffect } from "react";
import { HiLink, HiXMark } from "react-icons/hi2";

import Badge from "~/components/Badge";
import Editor from "~/components/Editor";
import LabelIcon from "~/components/LabelIcon";
import { useModal } from "~/providers/modal";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import ActivityList from "~/views/card/components/ActivityList";
import { CardWorkspaceDocument } from "~/views/card/components/CardWorkspaceDocument";
import Checklists from "~/views/card/components/Checklists";

export function CardModal({
  cardPublicId,
  workspaceSlug,
  boardSlug,
}: {
  cardPublicId: string | null | undefined;
  workspaceSlug: string | null | undefined;
  boardSlug: string | null | undefined;
}) {
  const router = useRouter();
  const { closeModal, isOpen } = useModal();
  const { showPopup } = usePopup();

  const handleCopyCardLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showPopup({
        header: t`Link copied`,
        icon: "success",
        message: t`Card URL copied to clipboard`,
      });
    } catch (error) {
      console.error(error);
      showPopup({
        header: t`Unable to copy link`,
        icon: "error",
        message: t`Please try again.`,
      });
    }
  };

  const { data, isLoading, error } = api.card.byId.useQuery(
    {
      cardPublicId: cardPublicId ?? "",
    },
    {
      enabled: isOpen && !!cardPublicId && cardPublicId.length >= 12,
    },
  );

  // Redirect to 404 if card doesn't exist
  useEffect(() => {
    if (isOpen && cardPublicId && !isLoading) {
      if (error?.data?.code === "NOT_FOUND" || (!data && error)) {
        // Close modal first, then redirect
        closeModal();
        void router.replace("/404");
      }
    }
  }, [isOpen, cardPublicId, isLoading, error, data, closeModal, router]);

  const labels = data?.labels ?? [];

  return (
    <div
      data-card-scroll-host
      className="max-h-[calc(100dvh-2rem)] w-full overflow-y-auto sm:max-h-[82dvh]"
    >
      <Dialog.Title className="sr-only">
        {data?.title ?? t`Card details`}
      </Dialog.Title>
      <div className="sticky top-0 z-20 border-b border-light-300 bg-light-50 px-5 py-4 dark:border-dark-400 dark:bg-dark-100 sm:px-8">
        <div className="flex w-full items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            {isLoading ? (
              <div className="h-8 w-72 max-w-full animate-pulse rounded-md bg-light-300 dark:bg-dark-300" />
            ) : (
              <>
                {data?.cardNumber != null &&
                  data.list.board.workspace.cardPrefix && (
                    <span className="mb-1 block text-xs font-medium text-light-700 dark:text-dark-800">
                      {data.list.board.workspace.cardPrefix}-{data.cardNumber}
                    </span>
                  )}
                <h1 className="truncate font-bold leading-[2.3rem] tracking-tight text-neutral-900 dark:text-dark-1000 sm:text-[1.2rem]">
                  {data?.title ?? t`Card details`}
                </h1>
              </>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={handleCopyCardLink}
              className="rounded p-1.5 transition-colors hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
              aria-label={t`Copy card link`}
            >
              <HiLink className="h-4 w-4 text-light-900 dark:text-dark-900" />
            </button>
            <button
              type="button"
              className="rounded p-1.5 transition-colors hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
              onClick={(event) => {
                event.preventDefault();
                closeModal();
                setTimeout(() => {
                  const nextQuery = { ...router.query };
                  delete nextQuery.view;
                  delete nextQuery.vista;
                  delete nextQuery.subtask;
                  delete nextQuery.recurso;
                  delete nextQuery.frame;
                  void router.replace(
                    {
                      pathname: router.pathname,
                      query: {
                        ...nextQuery,
                        workspaceSlug: workspaceSlug ?? "",
                        boardSlug: [boardSlug ?? ""],
                      },
                    },
                    undefined,
                    { shallow: true },
                  );
                }, 400);
              }}
              aria-label={t`Close`}
            >
              <HiXMark
                size={18}
                className="text-light-900 dark:text-dark-900"
              />
            </button>
          </div>
        </div>
        {labels.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {labels.map((label) => (
              <Badge
                key={label.publicId}
                value={label.name}
                iconLeft={<LabelIcon colourCode={label.colourCode} />}
              />
            ))}
          </div>
        )}
      </div>

      {data && cardPublicId ? (
        <div className="px-5 py-6 sm:px-8">
          <CardWorkspaceDocument
            key={cardPublicId}
            cardPublicId={cardPublicId}
            members={[]}
            canEdit={false}
            isPublicBoard
            subtaskSummary={data.subtaskSummary}
            resourceSummary={data.resourceSummary}
            hasCanvas={data.hasCanvas}
            preferenceScope="public"
            compact
            summaryContent={
              <>
                {data.description && (
                  <Editor
                    content={data.description}
                    readOnly
                    workspaceMembers={data.list.board.workspace.members}
                  />
                )}
                {data.checklists.length > 0 && (
                  <div className="mt-10">
                    <Checklists
                      checklists={data.checklists}
                      cardPublicId={cardPublicId}
                      viewOnly
                    />
                  </div>
                )}
              </>
            }
            activityContent={
              <>
                <h2 className="text-md pb-4 font-medium text-light-900 dark:text-dark-1000">
                  {t`Activity`}
                </h2>
                <ActivityList
                  cardPublicId={cardPublicId}
                  isLoading={false}
                  isViewOnly
                />
              </>
            }
          />
        </div>
      ) : (
        <div className="px-5 py-8 sm:px-8">
          <div className="h-28 animate-pulse rounded-md bg-light-200 dark:bg-dark-200" />
        </div>
      )}
    </div>
  );
}
