import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import { t } from "@lingui/core/macro";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  HiChevronDown,
  HiOutlineClipboardDocumentList,
  HiOutlineExclamationTriangle,
  HiOutlinePhoto,
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

const CardVisualWallView = dynamic(
  () =>
    import("./CardVisualWallView").then((module) => module.CardVisualWallView),
  {
    ssr: false,
    loading: () => (
      <div className="h-[32rem] min-h-[20rem] animate-pulse bg-light-200 dark:bg-dark-200" />
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
  members: WorkspaceMemberOption[];
  canEdit: boolean;
  isPublicBoard: boolean;
  subtaskSummary: CardWorkspaceSummary;
  resourceSummary: CardResourceSummary;
  hasCanvas: boolean;
  summaryContent: ReactNode;
  activityContent: ReactNode;
  preferenceScope: string;
  compact?: boolean;
}

interface WorkspacePreferences {
  subtasksOpen?: boolean;
  visualWallOpen?: boolean;
}

const sectionIds = {
  summary: "card-view-summary",
  files: "card-view-files",
  subtasks: "card-view-subtasks",
  visualWall: "card-view-visual-wall",
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
  members,
  canEdit,
  isPublicBoard,
  subtaskSummary,
  resourceSummary,
  hasCanvas,
  summaryContent,
  activityContent,
  preferenceScope,
  compact = false,
}: CardWorkspaceDocumentProps) {
  const router = useRouter();
  const preferenceKey = useMemo(
    () => `kan:card-workspace:v2:${preferenceScope}:${cardPublicId}`,
    [cardPublicId, preferenceScope],
  );
  const [subtasksPreference, setSubtasksPreference] = useState(
    subtaskSummary.total > 0,
  );
  const [visualWallPreference, setVisualWallPreference] = useState(hasCanvas);
  const [visualWallHasContent, setVisualWallHasContent] = useState(hasCanvas);
  const [subtasksMounted, setSubtasksMounted] = useState(false);
  const [visualWallMounted, setVisualWallMounted] = useState(false);
  const [subtasksActivationRequested, setSubtasksActivationRequested] =
    useState(false);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const scrollFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (hasCanvas) setVisualWallHasContent(true);
  }, [hasCanvas]);

  const targetView = getCardWorkspaceTargetView({
    value: router.query.vista,
    legacyValue: router.query.view,
    subtask: router.query.subtask,
    resource: router.query.recurso,
    frame: router.query.frame,
  });
  const subtasksOpen = targetView === "subtasks" ? true : subtasksPreference;
  const visualWallOpen =
    targetView === "visualWall" ? true : visualWallPreference;

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
    const nextVisualWallOpen = preferences.visualWallOpen ?? hasCanvas;

    setSubtasksPreference(nextSubtasksOpen);
    setVisualWallPreference(nextVisualWallOpen);
    setSubtasksMounted(nextSubtasksOpen);
    setVisualWallMounted(nextVisualWallOpen);
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
          visualWallOpen: visualWallPreference,
        }),
      );
    } catch {
      return;
    }
  }, [
    preferenceKey,
    preferencesReady,
    subtasksPreference,
    visualWallPreference,
  ]);

  useEffect(() => {
    if (!router.isReady || !targetView) return;

    if (targetView === "subtasks") {
      setSubtasksMounted(true);
    }
    if (targetView === "visualWall") {
      setVisualWallMounted(true);
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

  const replaceWorkspaceView = async (view: "subtasks" | "visualWall") => {
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

  const toggleVisualWall = () => {
    const nextOpen = !visualWallOpen;
    setVisualWallPreference(nextOpen);
    if (nextOpen) setVisualWallMounted(true);
    if (nextOpen) void replaceWorkspaceView("visualWall");
    else if (targetView === "visualWall") void clearWorkspaceTarget();
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
  const visualWallDescription = visualWallHasContent
    ? t`Preview the images and references that guide this project.`
    : canEdit
      ? t`Add images or connect the shared Freeform board.`
      : t`This card does not have a visual wall yet.`;

  return (
    <div
      className={twMerge(
        "mx-auto w-full max-w-6xl px-4 py-6 md:px-6 lg:px-8",
        compact && "max-w-none px-0 py-0",
      )}
    >
      <section
        id={sectionIds.summary}
        aria-label={t`Summary`}
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
        id={sectionIds.visualWall}
        aria-labelledby="card-workspace-visual-wall-heading"
        className="mt-10 scroll-mt-16 border-t border-light-300 dark:border-dark-400"
      >
        <DisclosureHeader
          id="card-workspace-visual-wall-heading"
          controls="card-workspace-visual-wall-content"
          title={t`Visual wall`}
          description={visualWallDescription}
          actionLabel={visualWallOpen ? t`Hide` : t`Show`}
          isOpen={visualWallOpen}
          onToggle={toggleVisualWall}
          icon={<HiOutlinePhoto className="h-5 w-5" aria-hidden="true" />}
        />
        <div
          id="card-workspace-visual-wall-content"
          role="region"
          aria-labelledby="card-workspace-visual-wall-heading"
          hidden={!visualWallOpen}
          className="pt-5"
        >
          {visualWallMounted && (
            <CardVisualWallView
              cardPublicId={cardPublicId}
              canEdit={canEdit}
              isPublicBoard={isPublicBoard}
              onContentChange={setVisualWallHasContent}
            />
          )}
        </div>
      </section>

      <section className="mt-12 border-t border-light-300 pt-10 dark:border-dark-400">
        <div className="max-w-3xl">{activityContent}</div>
      </section>
    </div>
  );
}
