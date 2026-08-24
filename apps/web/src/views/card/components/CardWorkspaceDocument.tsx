import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import { t } from "@lingui/core/macro";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  HiChevronDown,
  HiOutlineClipboardDocumentList,
  HiOutlineExclamationTriangle,
  HiOutlinePencilSquare,
} from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

import type { WorkspaceMemberOption } from "./subtask-types";
import {
  getCardWorkspaceNavigationQuery,
  getCardWorkspaceTargetView,
} from "~/utils/card-workspace";
import { CardSubtasksView } from "./CardSubtasksView";

const CardFilesView = dynamic(
  () => import("./CardFilesView").then((module) => module.CardFilesView),
  {
    ssr: false,
    loading: () => (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div
            key={item}
            className="h-56 animate-pulse rounded-lg bg-light-200 dark:bg-dark-200"
          />
        ))}
      </div>
    ),
  },
);

const CardWhiteboardView = dynamic(
  () =>
    import("./CardWhiteboardView").then((module) => module.CardWhiteboardView),
  {
    ssr: false,
    loading: () => (
      <div className="h-[68dvh] min-h-[24rem] animate-pulse rounded-md bg-light-200 dark:bg-dark-200" />
    ),
  },
);

interface CardWorkspaceSummary {
  total: number;
  completed: number;
  blocked: number;
  progressPercent: number;
}

interface CardResourceSummary {
  total: number;
  uploads: number;
  driveLinks: number;
  webLinks: number;
}

interface CardWorkspaceDocumentProps {
  cardPublicId: string;
  cardTitle: string;
  members: WorkspaceMemberOption[];
  canEdit: boolean;
  isPublicBoard: boolean;
  subtaskSummary: CardWorkspaceSummary;
  resourceSummary: CardResourceSummary;
  hasCanvas: boolean;
  summaryContent: ReactNode;
  activityContent: ReactNode;
  preferenceScope: string;
  whiteboardExtended: boolean;
  onWhiteboardExtendedChange: (extended: boolean) => void;
  compact?: boolean;
}

interface WorkspacePreferences {
  subtasksOpen?: boolean;
  whiteboardOpen?: boolean;
}

const sectionIds = {
  summary: "card-view-summary",
  files: "card-view-files",
  subtasks: "card-view-subtasks",
  whiteboard: "card-view-whiteboard",
} as const;

function DisclosureHeader({
  id,
  controls,
  title,
  description,
  actionLabel,
  isOpen,
  onToggle,
  icon,
  metric,
  progress,
  blocked,
}: {
  id: string;
  controls: string;
  title: string;
  description: string;
  actionLabel: string;
  isOpen: boolean;
  onToggle: () => void;
  icon: ReactNode;
  metric?: string;
  progress?: number;
  blocked?: number;
}) {
  return (
    <div>
      <button
        id={id}
        type="button"
        aria-expanded={isOpen}
        aria-controls={controls}
        onClick={onToggle}
        className="flex min-h-14 w-full items-center gap-3 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:focus-visible:ring-dark-800"
      >
        <span className="shrink-0 text-light-700 dark:text-dark-700">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-sm font-semibold text-light-1000 dark:text-dark-1000">
              {title}
            </span>
            {blocked !== undefined && blocked > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                <HiOutlineExclamationTriangle
                  className="h-3.5 w-3.5"
                  aria-hidden="true"
                />
                {t`${blocked} blocked`}
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-xs leading-5 text-light-700 dark:text-dark-700">
            {description}
          </span>
        </span>
        {metric && (
          <span className="shrink-0 text-sm font-semibold tabular-nums text-light-900 dark:text-dark-900">
            {metric}
          </span>
        )}
        <span className="hidden shrink-0 text-xs font-medium text-light-700 dark:text-dark-700 sm:block">
          {actionLabel}
        </span>
        <HiChevronDown
          className={twMerge(
            "h-4 w-4 shrink-0 text-light-700 transition-transform duration-300 dark:text-dark-700",
            isOpen && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>
      {progress !== undefined && (
        <div
          role="progressbar"
          aria-label={t`Development progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          className="h-1 overflow-hidden bg-light-300 dark:bg-dark-400"
        >
          <div
            className="h-full bg-blue-600 transition-[width] duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}

export function CardWorkspaceDocument({
  cardPublicId,
  cardTitle,
  members,
  canEdit,
  isPublicBoard,
  subtaskSummary,
  resourceSummary,
  hasCanvas,
  summaryContent,
  activityContent,
  preferenceScope,
  whiteboardExtended,
  onWhiteboardExtendedChange,
  compact = false,
}: CardWorkspaceDocumentProps) {
  const router = useRouter();
  const preferenceKey = useMemo(
    () => `kan:card-workspace:v1:${preferenceScope}:${cardPublicId}`,
    [cardPublicId, preferenceScope],
  );
  const [subtasksPreference, setSubtasksPreference] = useState(
    subtaskSummary.total > 0,
  );
  const [whiteboardPreference, setWhiteboardPreference] = useState(hasCanvas);
  const [canvasHasContent, setCanvasHasContent] = useState(hasCanvas);
  const [subtasksMounted, setSubtasksMounted] = useState(false);
  const [whiteboardMounted, setWhiteboardMounted] = useState(false);
  const [subtasksActivationRequested, setSubtasksActivationRequested] =
    useState(false);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const documentRef = useRef<HTMLDivElement>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const savedScrollTopRef = useRef(0);
  const layoutFrameRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (layoutFrameRef.current !== null) {
        window.cancelAnimationFrame(layoutFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (hasCanvas) setCanvasHasContent(true);
  }, [hasCanvas]);

  const targetView = getCardWorkspaceTargetView({
    value: router.query.vista,
    legacyValue: router.query.view,
    subtask: router.query.subtask,
    resource: router.query.recurso,
    frame: router.query.frame,
  });
  const subtasksOpen = targetView === "subtasks" ? true : subtasksPreference;
  const whiteboardOpen =
    targetView === "whiteboard" ? true : whiteboardPreference;

  useEffect(() => {
    setPreferencesReady(false);
    let preferences: WorkspacePreferences = {};
    try {
      const stored = window.localStorage.getItem(preferenceKey);
      if (stored) preferences = JSON.parse(stored) as WorkspacePreferences;
    } catch {
      preferences = {};
    }

    const nextSubtasksOpen =
      preferences.subtasksOpen ?? subtaskSummary.total > 0;
    const nextWhiteboardOpen = preferences.whiteboardOpen ?? hasCanvas;

    setSubtasksPreference(nextSubtasksOpen);
    setWhiteboardPreference(nextWhiteboardOpen);
    setSubtasksMounted(nextSubtasksOpen);
    setWhiteboardMounted(nextWhiteboardOpen);
    setSubtasksActivationRequested(false);
    setPreferencesReady(true);
  }, [cardPublicId, hasCanvas, preferenceKey, subtaskSummary.total]);

  useEffect(() => {
    if (!preferencesReady) return;
    try {
      window.localStorage.setItem(
        preferenceKey,
        JSON.stringify({
          subtasksOpen: subtasksPreference,
          whiteboardOpen: whiteboardPreference,
        }),
      );
    } catch {
      return;
    }
  }, [
    preferenceKey,
    preferencesReady,
    subtasksPreference,
    whiteboardPreference,
  ]);

  useEffect(() => {
    if (!router.isReady || !targetView) return;

    if (targetView === "subtasks") {
      setSubtasksMounted(true);
    }
    if (targetView === "whiteboard") {
      setWhiteboardMounted(true);
    }

    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
    }
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = window.requestAnimationFrame(() => {
        document.getElementById(sectionIds[targetView])?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    });

    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    };
  }, [router.isReady, targetView]);

  const replaceWorkspaceView = async (view: "subtasks" | "whiteboard") => {
    const query = getCardWorkspaceNavigationQuery(router.query, view);
    await router.replace({ pathname: router.pathname, query }, undefined, {
      shallow: true,
    });
  };

  const clearWorkspaceTarget = async () => {
    const query = { ...router.query };
    delete query.view;
    delete query.vista;
    delete query.subtask;
    delete query.recurso;
    delete query.frame;
    await router.replace({ pathname: router.pathname, query }, undefined, {
      shallow: true,
    });
  };

  const toggleSubtasks = () => {
    const nextOpen = !subtasksOpen;
    setSubtasksPreference(nextOpen);
    if (nextOpen) {
      setSubtasksMounted(true);
      if (canEdit && subtaskSummary.total === 0) {
        setSubtasksActivationRequested(true);
      }
    }
    if (nextOpen) void replaceWorkspaceView("subtasks");
    else if (targetView === "subtasks") void clearWorkspaceTarget();
  };

  const toggleWhiteboard = () => {
    const nextOpen = !whiteboardOpen;
    setWhiteboardPreference(nextOpen);
    if (nextOpen) setWhiteboardMounted(true);
    if (nextOpen) void replaceWorkspaceView("whiteboard");
    else if (targetView === "whiteboard") void clearWorkspaceTarget();
  };

  const setWhiteboardExtension = (extended: boolean) => {
    const scrollHost = documentRef.current?.closest<HTMLElement>(
      "[data-card-scroll-host]",
    );
    if (extended) {
      savedScrollTopRef.current = scrollHost?.scrollTop ?? 0;
      setWhiteboardPreference(true);
      setWhiteboardMounted(true);
    }
    onWhiteboardExtendedChange(extended);
    if (layoutFrameRef.current !== null) {
      window.cancelAnimationFrame(layoutFrameRef.current);
    }
    layoutFrameRef.current = window.requestAnimationFrame(() => {
      if (scrollHost) {
        scrollHost.scrollTop = extended ? 0 : savedScrollTopRef.current;
      }
      if (!extended) {
        document.getElementById("card-workspace-whiteboard-heading")?.focus();
      }
    });
  };

  const requestSubtasksInitialization = () => {
    document.getElementById("card-workspace-subtasks-heading")?.focus();
    setSubtasksActivationRequested(true);
  };

  const subtaskDescription =
    subtaskSummary.total === 0
      ? canEdit
        ? t`Activate the pipeline when you are ready to break down the work.`
        : t`This card does not have subtasks yet.`
      : t`${subtaskSummary.completed} of ${subtaskSummary.total} subtasks completed`;
  const subtaskAction = subtasksOpen
    ? t`Hide`
    : subtaskSummary.total === 0 && canEdit
      ? t`Activate subtasks`
      : t`Show`;
  const whiteboardDescription = canvasHasContent
    ? t`The visual workspace has content.`
    : canEdit
      ? t`Open a blank canvas without creating anything until your first change.`
      : t`This card does not have a whiteboard yet.`;

  return (
    <div
      ref={documentRef}
      className={twMerge(
        "mx-auto w-full max-w-6xl px-4 py-6 md:px-6 lg:px-8",
        compact && "max-w-none px-0 py-0",
        whiteboardExtended && "h-full max-w-none p-0 md:p-0 lg:p-0",
      )}
    >
      <section
        id={sectionIds.summary}
        aria-label={t`Summary`}
        hidden={whiteboardExtended}
        className="scroll-mt-16"
      >
        <div className="max-w-3xl">{summaryContent}</div>
      </section>

      <section
        id={sectionIds.files}
        aria-label={
          resourceSummary.total === 1
            ? t`1 resource`
            : t`${resourceSummary.total} resources`
        }
        hidden={whiteboardExtended}
        className="mt-10 scroll-mt-16 border-t border-light-300 pt-8 dark:border-dark-400"
      >
        <CardFilesView
          cardPublicId={cardPublicId}
          canEdit={canEdit}
          isPublicBoard={isPublicBoard}
          embedded
        />
      </section>

      <section
        id={sectionIds.subtasks}
        aria-labelledby="card-workspace-subtasks-heading"
        hidden={whiteboardExtended}
        className="mt-10 scroll-mt-16 border-t border-light-300 dark:border-dark-400"
      >
        <DisclosureHeader
          id="card-workspace-subtasks-heading"
          controls="card-workspace-subtasks-content"
          title={t`Subtasks`}
          description={subtaskDescription}
          actionLabel={subtaskAction}
          isOpen={subtasksOpen}
          onToggle={toggleSubtasks}
          icon={
            <HiOutlineClipboardDocumentList
              className="h-5 w-5"
              aria-hidden="true"
            />
          }
          metric={
            subtaskSummary.total > 0
              ? `${subtaskSummary.progressPercent}%`
              : undefined
          }
          progress={
            subtaskSummary.total > 0
              ? subtaskSummary.progressPercent
              : undefined
          }
          blocked={subtaskSummary.blocked}
        />
        <div
          id="card-workspace-subtasks-content"
          role="region"
          aria-labelledby="card-workspace-subtasks-heading"
          hidden={!subtasksOpen}
          className="pt-5"
        >
          {subtasksMounted && (
            <CardSubtasksView
              key={cardPublicId}
              cardPublicId={cardPublicId}
              members={members}
              canEdit={canEdit}
              enabled={subtasksMounted}
              embedded
              initializationRequested={
                subtaskSummary.total > 0 || subtasksActivationRequested
              }
              onRequestInitialization={requestSubtasksInitialization}
              singleStageLayout={compact}
            />
          )}
        </div>
      </section>

      <section
        id={sectionIds.whiteboard}
        aria-labelledby="card-workspace-whiteboard-heading"
        className={twMerge(
          "mt-10 scroll-mt-16 border-t border-light-300 dark:border-dark-400",
          whiteboardExtended && "m-0 h-full border-0",
        )}
      >
        <div hidden={whiteboardExtended}>
          <DisclosureHeader
            id="card-workspace-whiteboard-heading"
            controls="card-workspace-whiteboard-content"
            title={t`Whiteboard`}
            description={whiteboardDescription}
            actionLabel={whiteboardOpen ? t`Hide` : t`Open whiteboard`}
            isOpen={whiteboardOpen}
            onToggle={toggleWhiteboard}
            icon={
              <HiOutlinePencilSquare className="h-5 w-5" aria-hidden="true" />
            }
          />
        </div>
        <div
          id="card-workspace-whiteboard-content"
          role="region"
          aria-labelledby="card-workspace-whiteboard-heading"
          hidden={!whiteboardOpen && !whiteboardExtended}
          className={whiteboardExtended ? "h-full" : "pt-5"}
        >
          {(whiteboardMounted || whiteboardExtended) && (
            <CardWhiteboardView
              cardPublicId={cardPublicId}
              cardTitle={cardTitle}
              members={members}
              canEdit={canEdit}
              isPublicBoard={isPublicBoard}
              embedded
              isVisible={whiteboardOpen || whiteboardExtended}
              extended={whiteboardExtended}
              onExtendedChange={setWhiteboardExtension}
              onCanvasCreated={() => setCanvasHasContent(true)}
            />
          )}
        </div>
      </section>

      <section
        hidden={whiteboardExtended}
        className="mt-12 border-t border-light-300 pt-10 dark:border-dark-400"
      >
        <div className="max-w-3xl">{activityContent}</div>
      </section>
    </div>
  );
}
