import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import { Dialog } from "@headlessui/react";
import { t } from "@lingui/core/macro";
import { useEffect, useRef, useState } from "react";
import { HiLink, HiXMark } from "react-icons/hi2";

import Badge from "~/components/Badge";
import Editor from "~/components/Editor";
import LabelIcon from "~/components/LabelIcon";
import { useModal } from "~/providers/modal";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import { getCardWorkspaceView } from "~/utils/card-workspace";
import ActivityList from "~/views/card/components/ActivityList";
import { CardResourceSummary } from "~/views/card/components/CardResourceSummary";
import { CardSubtasksView } from "~/views/card/components/CardSubtasksView";
import { CardWorkspaceTabs } from "~/views/card/components/CardWorkspaceTabs";
import Checklists from "~/views/card/components/Checklists";
import { DevelopmentProgress } from "~/views/card/components/DevelopmentProgress";

const CardFilesView = dynamic(
  () =>
    import("~/views/card/components/CardFilesView").then(
      (module) => module.CardFilesView,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="grid grid-cols-1 gap-3 p-1 sm:grid-cols-2">
        {[0, 1].map((item) => (
          <div
            key={item}
            className="h-52 animate-pulse rounded-lg bg-light-200 dark:bg-dark-200"
          />
        ))}
      </div>
    ),
  },
);

const CardWhiteboardView = dynamic(
  () =>
    import("~/views/card/components/CardWhiteboardView").then(
      (module) => module.CardWhiteboardView,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="h-full min-h-[24rem] animate-pulse bg-light-200 dark:bg-dark-200" />
    ),
  },
);

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
  const [showFade, setShowFade] = useState(false);
  const [showTopFade, setShowTopFade] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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
  const activeView = getCardWorkspaceView(
    router.query.vista,
    router.query.view,
  );

  const handleScroll = () => {
    if (!scrollRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - 5;
    const isAtTop = scrollTop <= 5;

    setShowFade(!isAtBottom);
    setShowTopFade(!isAtTop);
  };

  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    handleScroll();

    scrollElement.addEventListener("scroll", handleScroll);
    return () => scrollElement.removeEventListener("scroll", handleScroll);
  }, [data]);

  return (
    <div className="flex h-full flex-1 flex-row">
      <Dialog.Title className="sr-only">
        {data?.title ?? t`Card details`}
      </Dialog.Title>
      <div className="flex h-full w-full flex-col overflow-hidden">
        <div className="h-full p-8">
          <div className="mb-6">
            <div className="flex w-full items-start justify-between gap-4">
              <div className="flex-1">
                {isLoading ? (
                  <div className="flex space-x-2">
                    <div className="h-[2.3rem] w-[300px] animate-pulse rounded-[5px] bg-light-300 dark:bg-dark-300" />
                  </div>
                ) : (
                  <>
                    {data?.cardNumber != null &&
                      data.list.board.workspace.cardPrefix && (
                        <span className="mb-1 block text-xs font-medium text-light-700 dark:text-dark-800">
                          {data.list.board.workspace.cardPrefix}-
                          {data.cardNumber}
                        </span>
                      )}
                    <h1 className="font-bold leading-[2.3rem] tracking-tight text-neutral-900 dark:text-dark-1000 sm:text-[1.2rem]">
                      {data?.title}
                    </h1>
                  </>
                )}
              </div>
              <div className="flex flex-shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={handleCopyCardLink}
                  className="rounded p-1.5 transition-all hover:bg-light-200 focus:outline-none dark:hover:bg-dark-100"
                  aria-label="Copy card link"
                >
                  <HiLink className="h-4 w-4 text-light-900 dark:text-dark-900" />
                </button>
                <button
                  type="button"
                  className="rounded p-1.5 transition-all hover:bg-light-200 focus:outline-none dark:hover:bg-dark-100"
                  onClick={(e) => {
                    e.preventDefault();
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
              <div className="mt-2">
                {labels.map((label) => (
                  <Badge
                    key={label.publicId}
                    value={label.name}
                    iconLeft={<LabelIcon colourCode={label.colourCode} />}
                  />
                ))}
              </div>
            )}
            {data && (
              <div className="mt-4 border-t border-light-300 pt-2 dark:border-dark-400">
                <CardWorkspaceTabs
                  activeView={activeView}
                  developmentCount={data.subtaskSummary.total}
                  resourceCount={data.resourceSummary.total}
                  hasCanvas={data.hasCanvas}
                  compact
                />
              </div>
            )}
          </div>

          {activeView === "summary" && (
            <div
              className="relative"
              id="card-view-summary"
              role="tabpanel"
              aria-labelledby="card-tab-summary"
            >
              <div
                ref={scrollRef}
                className="h-full max-h-[425px] overflow-y-auto"
              >
                {data?.description && (
                  <div className="mb-10 flex w-full max-w-2xl justify-between">
                    <div className="mt-2">
                      <Editor
                        content={data.description}
                        readOnly
                        workspaceMembers={data.list.board.workspace.members}
                      />
                    </div>
                  </div>
                )}
                {data && (
                  <div className="mb-8 max-w-2xl">
                    <DevelopmentProgress
                      summary={data.subtaskSummary}
                      interactive={false}
                    />
                  </div>
                )}
                {data && (
                  <div className="mb-8 max-w-2xl">
                    <CardResourceSummary {...data.resourceSummary} />
                  </div>
                )}
                {data?.checklists && data.checklists.length > 0 && (
                  <Checklists
                    checklists={data.checklists}
                    cardPublicId={cardPublicId ?? ""}
                    viewOnly
                  />
                )}
                <div className="border-t-[1px] border-light-600 pb-4 pt-12 dark:border-dark-400">
                  <h2 className="text-md pb-4 font-medium text-light-900 dark:text-dark-1000">
                    {t`Activity`}
                  </h2>
                  <div>
                    {cardPublicId && (
                      <ActivityList
                        cardPublicId={cardPublicId}
                        isLoading={isLoading}
                        isViewOnly={true}
                      />
                    )}
                  </div>
                </div>
              </div>
              {showTopFade && (
                <div className="pointer-events-none absolute left-0 right-0 top-0 h-6 bg-gradient-to-b from-white/80 to-transparent dark:from-dark-100/80" />
              )}
              {showFade && (
                <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-white/80 to-transparent dark:from-dark-100/80" />
              )}
            </div>
          )}
          {activeView === "subtasks" && data && cardPublicId && (
            <div className="h-[min(32rem,calc(100dvh-15rem))] min-h-[24rem] overflow-hidden">
              <CardSubtasksView
                key={cardPublicId}
                cardPublicId={cardPublicId}
                members={[]}
                canEdit={false}
                singleStageLayout
              />
            </div>
          )}
          {activeView === "whiteboard" && (
            <div className="h-[100dvh] overflow-hidden">
              <CardWhiteboardView
                cardPublicId={cardPublicId ?? ""}
                cardTitle={data?.title ?? t`Card`}
                members={[]}
                canEdit={false}
                isPublicBoard
                compact
              />
            </div>
          )}
          {activeView === "files" && (
            <div className="h-[min(36rem,calc(100dvh-12rem))] min-h-80 overflow-hidden">
              <CardFilesView
                cardPublicId={cardPublicId ?? ""}
                canEdit={false}
                isPublicBoard
                compact
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
