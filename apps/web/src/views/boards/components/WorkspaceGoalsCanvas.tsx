import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import { Excalidraw } from "@excalidraw/excalidraw";
import { t } from "@lingui/core/macro";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HiArrowPath, HiOutlineExclamationTriangle } from "react-icons/hi2";

import { authClient } from "@kan/auth/client";

import type { CardCanvasExportFormat } from "~/views/card/components/card-canvas-export";
import { useDashboardSurface } from "~/components/DashboardSurfaceContext";
import { useLocalisation } from "~/hooks/useLocalisation";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import { BOARDS_REENTRY_EVENT } from "~/utils/boards-reentry";
import {
  captureCardCanvasDocument,
  hasCardCanvasDocumentChanged,
  seedCardCanvasDocumentSnapshot,
} from "~/views/card/components/card-canvas-document-change";
import {
  toCardCanvasScene,
  toExcalidrawAppState,
} from "~/views/card/components/card-canvas-excalidraw-adapter";
import { exportCardCanvas } from "~/views/card/components/card-canvas-export";
import { getExcalidrawLanguage } from "~/views/card/components/card-canvas-localization";
import { CardCanvasConflictDialog } from "~/views/card/components/CardCanvasConflictDialog";
import { CardCanvasHistoryDrawer } from "~/views/card/components/CardCanvasHistoryDrawer";
import { useCardCanvasPen } from "~/views/card/components/use-card-canvas-pen";
import { useCardCanvasViewport } from "~/views/card/components/use-card-canvas-viewport";
import { useWorkspaceCanvas } from "./use-workspace-canvas";
import { useWorkspaceCanvasPaste } from "./use-workspace-canvas-paste";
import { getWorkspaceCanvasImagePublicIds } from "./workspace-canvas-image-ids";
import { restoreWorkspaceCanvasRevision } from "./workspace-canvas-restore";
import {
  isWorkspaceCanvasToolForbidden,
  sanitizeWorkspaceCanvasElements,
} from "./workspace-canvas-scene-policy";
import {
  isWorkspaceCanvasEscapeNeutral,
  isWorkspaceCanvasGlobalShortcut,
} from "./workspace-canvas-shortcuts";
import {
  clampWorkspaceCanvasCamera,
  constrainWorkspaceCanvasOutliers,
  constrainWorkspaceCanvasSelection,
  getWorkspaceCanvasHomeCamera,
} from "./workspace-canvas-vertical-track";
import { WorkspaceGoalsToolbar } from "./WorkspaceGoalsToolbar";

interface WorkspaceGoalsCanvasProps {
  workspacePublicId: string;
  workspaceName: string;
  canEdit: boolean;
}

const WORKSPACE_CANVAS_EXPORT_MAX_DIMENSION = 4_096;

export function WorkspaceGoalsCanvas({
  workspacePublicId,
  workspaceName,
  canEdit,
}: WorkspaceGoalsCanvasProps) {
  const { resolvedTheme } = useTheme();
  const { locale } = useLocalisation();
  const { showPopup } = usePopup();
  const { data: session } = authClient.useSession();
  const { scrollContainerRef, setMode } = useDashboardSurface();
  const [excalidrawApi, setExcalidrawApi] =
    useState<ExcalidrawImperativeAPI | null>(null);
  const [extended, setExtended] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const sectionRef = useRef<HTMLElement | null>(null);
  const applyingSceneRef = useRef(false);
  const viewportFrameRef = useRef<number | null>(null);
  const homeEpochRef = useRef<string | null>(null);
  const previousScrollTopRef = useRef(0);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const historyFocusRef = useRef<HTMLElement | null>(null);
  const documentSnapshotKeyRef = useRef<string | null>(null);
  const documentSnapshotRef = useRef<ReturnType<
    typeof captureCardCanvasDocument
  > | null>(null);
  const controller = useWorkspaceCanvas({
    workspacePublicId,
    userId: session?.user.id ?? null,
    canEdit,
  });
  const documentSnapshotKey = `${workspacePublicId}:${controller.sceneEpoch}`;
  if (
    controller.scene &&
    documentSnapshotKeyRef.current !== documentSnapshotKey
  ) {
    const seededSnapshot = seedCardCanvasDocumentSnapshot(
      documentSnapshotRef.current,
      documentSnapshotKeyRef.current,
      documentSnapshotKey,
      controller.scene.elements,
      toExcalidrawAppState(controller.scene.appState),
    );
    documentSnapshotRef.current = seededSnapshot.snapshot;
    documentSnapshotKeyRef.current = seededSnapshot.key;
  }
  const effectiveCanEdit = canEdit && !controller.viewModeEnabled;
  const controllerImagePublicIds = useMemo(
    () =>
      [
        ...getWorkspaceCanvasImagePublicIds(
          (controller.scene?.elements ?? []) as unknown as ExcalidrawElement[],
        ),
      ].sort(),
    [controller.scene?.elements],
  );
  const [liveImageReferences, setLiveImageReferences] = useState<{
    documentKey: string;
    publicIds: string[];
  } | null>(null);
  const imagePublicIds =
    liveImageReferences?.documentKey === documentSnapshotKey
      ? liveImageReferences.publicIds
      : controllerImagePublicIds;
  const penPreferenceKey = useMemo(
    () =>
      `kan:workspace-canvas:pen-mode:v1:${session?.user.id ?? "device"}:${workspacePublicId}`,
    [session?.user.id, workspacePublicId],
  );
  const pen = useCardCanvasPen({
    api: excalidrawApi,
    canEdit: effectiveCanEdit,
    preferenceKey: penPreferenceKey,
  });
  const paste = useWorkspaceCanvasPaste({
    workspacePublicId,
    imagePublicIds,
    canvasApi: excalidrawApi,
    canEdit: effectiveCanEdit,
  });

  const historyQuery = api.workspaceCanvas.listRevisions.useQuery(
    { workspacePublicId },
    { enabled: effectiveCanEdit && historyOpen, retry: 1 },
  );
  const restoreMutation = api.workspaceCanvas.restore.useMutation();

  useCardCanvasViewport({
    api: excalidrawApi,
    sectionRef,
    enabled: true,
    layoutKey: extended,
    scrollContainerRef,
  });

  const applyViewportBounds = useCallback(
    (appState?: AppState) => {
      if (!excalidrawApi) return;
      const current = appState ?? excalidrawApi.getAppState();
      const bounded = clampWorkspaceCanvasCamera({
        viewportWidth: current.width,
        viewportHeight: current.height,
        zoom: current.zoom,
        scrollX: current.scrollX,
        scrollY: current.scrollY,
      });
      if (
        Math.abs(current.scrollX - bounded.scrollX) < 0.5 &&
        Math.abs(current.scrollY - bounded.scrollY) < 0.5 &&
        current.zoom.value === bounded.zoom.value
      ) {
        return;
      }
      if (viewportFrameRef.current !== null) {
        cancelAnimationFrame(viewportFrameRef.current);
      }
      viewportFrameRef.current = requestAnimationFrame(() => {
        applyingSceneRef.current = true;
        excalidrawApi.updateScene({ appState: bounded });
        queueMicrotask(() => {
          applyingSceneRef.current = false;
        });
      });
    },
    [excalidrawApi],
  );

  const goHome = useCallback(() => {
    if (!excalidrawApi) return;
    const home = getWorkspaceCanvasHomeCamera({
      viewportWidth: excalidrawApi.getAppState().width,
    });
    applyingSceneRef.current = true;
    excalidrawApi.updateScene({
      appState: {
        scrollX: home.scrollX,
        scrollY: home.scrollY,
        zoom: home.zoom,
      },
    });
    queueMicrotask(() => {
      applyingSceneRef.current = false;
    });
  }, [excalidrawApi]);

  useEffect(() => {
    window.addEventListener(BOARDS_REENTRY_EVENT, goHome);
    return () => window.removeEventListener(BOARDS_REENTRY_EVENT, goHome);
  }, [goHome]);

  useEffect(() => {
    if (!excalidrawApi || !controller.scene || applyingSceneRef.current) return;
    applyingSceneRef.current = true;
    const appState = toExcalidrawAppState(controller.scene.appState);
    const elements = controller.scene
      .elements as unknown as ExcalidrawElement[];
    documentSnapshotRef.current = captureCardCanvasDocument(elements, appState);
    documentSnapshotKeyRef.current = documentSnapshotKey;
    excalidrawApi.updateScene({ elements, appState });
    const clearHistory = excalidrawApi.history.clear as unknown as () => void;
    clearHistory();
    queueMicrotask(() => {
      applyingSceneRef.current = false;
      const homeKey = `${workspacePublicId}:${controller.sceneEpoch}`;
      if (homeEpochRef.current !== homeKey) {
        homeEpochRef.current = homeKey;
        goHome();
      }
    });
  }, [
    controller.scene,
    controller.sceneEpoch,
    documentSnapshotKey,
    excalidrawApi,
    goHome,
    workspacePublicId,
  ]);

  useEffect(() => {
    if (!excalidrawApi || !sectionRef.current) return;
    const refresh = () => {
      excalidrawApi.refresh();
      applyViewportBounds();
    };
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(refresh);
    observer?.observe(sectionRef.current);
    return () => observer?.disconnect();
  }, [applyViewportBounds, excalidrawApi]);

  useEffect(
    () => () => {
      if (viewportFrameRef.current !== null) {
        cancelAnimationFrame(viewportFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    setMode(extended ? "workspace-whiteboard" : "default");
    return () => setMode("default");
  }, [extended, setMode]);

  const toggleExtended = useCallback(() => {
    if (!extended) {
      previousScrollTopRef.current = scrollContainerRef.current?.scrollTop ?? 0;
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setExtended(true);
      return;
    }
    setExtended(false);
    requestAnimationFrame(() => {
      scrollContainerRef.current?.scrollTo({
        top: previousScrollTopRef.current,
      });
      previousFocusRef.current?.focus();
    });
  }, [extended, scrollContainerRef]);

  const closeHistory = useCallback(() => {
    setHistoryOpen(false);
    requestAnimationFrame(() => historyFocusRef.current?.focus());
  }, []);

  const toggleHistory = useCallback(() => {
    if (!historyOpen) {
      const activeElement =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      historyFocusRef.current =
        activeElement?.closest("details")?.querySelector("summary") ??
        activeElement;
      setHistoryOpen(true);
      return;
    }
    closeHistory();
  }, [closeHistory, historyOpen]);

  useEffect(() => {
    if (!extended) return;
    const handleEscapeCapture = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const appState = excalidrawApi?.getAppState();
      if (
        !isWorkspaceCanvasEscapeNeutral(appState, {
          conflictOpen: controller.saveState === "conflict",
          detailsOpen: Boolean(
            sectionRef.current?.querySelector("details[open]"),
          ),
          historyOpen,
        })
      ) {
        return;
      }
      requestAnimationFrame(() => toggleExtended());
    };
    window.addEventListener("keydown", handleEscapeCapture, true);
    return () =>
      window.removeEventListener("keydown", handleEscapeCapture, true);
  }, [
    controller.saveState,
    excalidrawApi,
    extended,
    historyOpen,
    toggleExtended,
  ]);

  const handleSceneChange = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState) => {
      if (!excalidrawApi || applyingSceneRef.current) return;
      applyViewportBounds(appState);
      if (isWorkspaceCanvasToolForbidden(appState.activeTool.type)) {
        excalidrawApi.setActiveTool({ type: "selection" });
      }
      const interactionInProgress = [
        Boolean(appState.newElement),
        Boolean(appState.resizingElement),
        Boolean(appState.multiElement),
        appState.isResizing,
        appState.isRotating,
        appState.selectedElementsAreBeingDragged,
        Boolean(appState.editingTextElement),
        Boolean(appState.editingLinearElement),
      ].some(Boolean);
      if (
        !hasCardCanvasDocumentChanged(
          documentSnapshotRef.current,
          elements,
          appState,
        ) ||
        interactionInProgress
      ) {
        return;
      }
      const sanitized = sanitizeWorkspaceCanvasElements(elements);
      const sanitizedElements = sanitized.changed
        ? sanitized.elements
        : elements;
      const clamped = Object.keys(appState.selectedElementIds).length
        ? constrainWorkspaceCanvasSelection(
            sanitizedElements,
            appState.selectedElementIds,
          )
        : { elements: sanitizedElements, changed: false };
      const selectionSafeElements = clamped.changed
        ? clamped.elements
        : sanitizedElements;
      const bounded = constrainWorkspaceCanvasOutliers(selectionSafeElements);
      const safeElements = bounded.changed
        ? bounded.elements
        : selectionSafeElements;
      const adapted = toCardCanvasScene(safeElements, appState);
      const renderedElements =
        adapted.elements as unknown as ExcalidrawElement[];
      const sceneElements = adapted.changed ? renderedElements : safeElements;
      const nextImagePublicIds = [
        ...getWorkspaceCanvasImagePublicIds(sceneElements),
      ].sort();
      setLiveImageReferences((current) => {
        if (
          current?.documentKey === documentSnapshotKey &&
          current.publicIds.length === nextImagePublicIds.length &&
          current.publicIds.every(
            (publicId, index) => publicId === nextImagePublicIds[index],
          )
        ) {
          return current;
        }
        return {
          documentKey: documentSnapshotKey,
          publicIds: nextImagePublicIds,
        };
      });
      if (
        sanitized.changed ||
        clamped.changed ||
        bounded.changed ||
        adapted.changed
      ) {
        applyingSceneRef.current = true;
        excalidrawApi.updateScene({ elements: sceneElements });
        queueMicrotask(() => {
          applyingSceneRef.current = false;
        });
      }
      documentSnapshotRef.current = captureCardCanvasDocument(
        sceneElements,
        appState,
      );
      controller.onSceneChange(adapted.scene);
    },
    [applyViewportBounds, controller, documentSnapshotKey, excalidrawApi],
  );

  const exportCanvas = useCallback(
    async (format: CardCanvasExportFormat) => {
      if (!excalidrawApi) return;
      try {
        await exportCardCanvas({
          api: excalidrawApi,
          title: t`Vision and goals for ${workspaceName}`,
          format,
          maxImageDimension: WORKSPACE_CANVAS_EXPORT_MAX_DIMENSION,
          resourceTitles: new Map(),
          subtaskTitles: new Map(),
        });
      } catch {
        showPopup({
          header: t`Whiteboard could not be exported`,
          message: t`Add at least one visible element and try again.`,
          icon: "error",
        });
      }
    },
    [excalidrawApi, showPopup, workspaceName],
  );

  const loadRemoteAndCleanupDraftImages = useCallback(async () => {
    const localImagePublicIds = getWorkspaceCanvasImagePublicIds(
      excalidrawApi?.getSceneElements() ?? [],
    );
    const head = await controller.loadRemoteVersion();
    if (!head) return false;
    const remoteImagePublicIds = getWorkspaceCanvasImagePublicIds(
      (head.scene?.elements ?? []) as unknown as ExcalidrawElement[],
    );
    try {
      await paste.deleteUnusedImages(
        [...localImagePublicIds].filter(
          (publicId) => !remoteImagePublicIds.has(publicId),
        ),
      );
      await paste.refreshImages();
    } catch {
      showPopup({
        header: t`Remote whiteboard loaded`,
        message: t`Some unused local images could not be cleaned up. Your whiteboard content is safe.`,
        icon: "error",
      });
    }
    return true;
  }, [controller, excalidrawApi, paste, showPopup]);

  const loadRemoteAfterConflict = useCallback(async () => {
    try {
      await loadRemoteAndCleanupDraftImages();
    } catch {
      showPopup({
        header: t`Remote whiteboard could not be loaded`,
        message: t`Your local draft remains available. Check your connection and try again.`,
        icon: "error",
      });
    }
  }, [loadRemoteAndCleanupDraftImages, showPopup]);

  const restoreRevision = useCallback(
    async (revisionPublicId: string) => {
      try {
        const result = await restoreWorkspaceCanvasRevision({
          commit: () =>
            restoreMutation.mutateAsync({
              workspacePublicId,
              revisionPublicId,
              expectedVersion: controller.version,
            }),
          synchronizeRemote: loadRemoteAndCleanupDraftImages,
          refreshHistory: () => historyQuery.refetch(),
        });
        if (result.status === "conflict") {
          controller.reportConflict(result.remoteVersion);
          return;
        }
        if (result.status === "restored-sync-failed") {
          controller.reportConflict(result.version);
          showPopup({
            header: t`Revision restored on the server`,
            message: t`This view could not be refreshed. Load the remote version before editing again.`,
            icon: "error",
          });
          return;
        }
        showPopup({
          header: t`Revision restored`,
          message: t`The previous workspace whiteboard was preserved as a checkpoint.`,
          icon: "success",
        });
      } catch {
        showPopup({
          header: t`Revision could not be restored`,
          message: t`The current whiteboard was not changed.`,
          icon: "error",
        });
      }
    },
    [
      controller,
      historyQuery,
      loadRemoteAndCleanupDraftImages,
      restoreMutation,
      showPopup,
      workspacePublicId,
    ],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (
        isWorkspaceCanvasGlobalShortcut({
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
        })
      ) {
        event.stopPropagation();
        return;
      }
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const appState = excalidrawApi?.getAppState();
      if (
        appState?.editingTextElement ||
        appState?.editingLinearElement ||
        appState?.openDialog
      ) {
        return;
      }
      const openMenu =
        sectionRef.current?.querySelector<HTMLDetailsElement>("details[open]");
      if (openMenu) {
        openMenu.open = false;
        openMenu.querySelector<HTMLElement>("summary")?.focus();
        return;
      }
      if (historyOpen) {
        closeHistory();
        return;
      }
      if (
        !extended ||
        Object.keys(appState?.selectedElementIds ?? {}).length > 0
      ) {
        return;
      }
      toggleExtended();
    },
    [closeHistory, excalidrawApi, extended, historyOpen, toggleExtended],
  );

  if (controller.error) {
    return (
      <div className="flex h-[70dvh] min-h-[28rem] items-center justify-center bg-light-100 p-6 text-center dark:bg-dark-50">
        <div>
          <HiOutlineExclamationTriangle className="mx-auto h-7 w-7 text-red-600 dark:text-red-400" />
          <p className="mt-3 text-sm font-medium text-light-1000 dark:text-dark-1000">
            {t`Workspace whiteboard could not be loaded`}
          </p>
          <button
            type="button"
            onClick={() => void controller.retryInitialLoad()}
            className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md border border-light-500 px-3 py-2 text-xs font-medium text-light-900 hover:bg-light-200 dark:border-dark-500 dark:text-dark-900 dark:hover:bg-dark-200"
          >
            <HiArrowPath className="h-4 w-4" />
            {t`Try again`}
          </button>
        </div>
      </div>
    );
  }

  if (controller.isLoading || !controller.scene) {
    return (
      <div
        className="flex h-[70dvh] min-h-[28rem] items-center justify-center bg-light-100 dark:bg-dark-50"
        role="status"
      >
        <div className="flex items-center gap-2 text-sm text-light-700 dark:text-dark-700">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-light-400 border-t-light-900 dark:border-dark-400 dark:border-t-dark-900" />
          {t`Opening workspace whiteboard…`}
        </div>
      </div>
    );
  }

  return (
    <section
      ref={sectionRef}
      aria-label={t`Vision and goals for ${workspaceName}`}
      data-global-shortcuts-suspended={extended || undefined}
      onKeyDown={handleKeyDown}
      className={
        extended
          ? "kan-workspace-canvas fixed inset-0 z-[130] flex h-[100dvh] min-h-0 w-screen flex-col overflow-hidden bg-light-100 dark:bg-dark-50"
          : "kan-workspace-canvas relative flex h-[70dvh] max-h-[58rem] min-h-[28rem] w-full min-w-0 flex-col overflow-hidden bg-light-100 dark:bg-dark-50"
      }
    >
      <WorkspaceGoalsToolbar
        workspaceName={workspaceName}
        saveState={controller.saveState}
        canEdit={effectiveCanEdit}
        extended={extended}
        penModeEnabled={pen.enabled}
        historyOpen={historyOpen}
        pasteBusy={paste.isBusy}
        onPaste={
          effectiveCanEdit ? () => paste.pasteFromClipboard() : undefined
        }
        onAddImage={
          effectiveCanEdit ? () => imageInputRef.current?.click() : undefined
        }
        onTogglePenMode={effectiveCanEdit ? pen.toggle : undefined}
        onHome={goHome}
        onToggleHistory={toggleHistory}
        onExport={(format) => void exportCanvas(format)}
        onToggleExtended={toggleExtended}
        onRetrySave={effectiveCanEdit ? controller.retrySave : undefined}
      />
      {effectiveCanEdit && (
        <input
          ref={imageInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            paste.importFiles(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = "";
          }}
        />
      )}
      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        onPasteCapture={paste.handlePasteCapture}
        onDragOverCapture={paste.handleDragOverCapture}
        onDropCapture={paste.handleDropCapture}
        onPointerDownCapture={pen.handlePointerDownCapture}
      >
        <Excalidraw
          excalidrawAPI={setExcalidrawApi}
          initialData={{
            elements: controller.scene
              .elements as unknown as ExcalidrawElement[],
            appState: toExcalidrawAppState(controller.scene.appState),
          }}
          onChange={handleSceneChange}
          onPaste={paste.handleExcalidrawPaste}
          viewModeEnabled={!effectiveCanEdit}
          aiEnabled={false}
          theme={resolvedTheme === "dark" ? "dark" : "light"}
          langCode={getExcalidrawLanguage(locale)}
          autoFocus={false}
          detectScroll
          UIOptions={{
            tools: { image: false },
            canvasActions: {
              loadScene: false,
              saveToActiveFile: false,
              export: false,
              saveAsImage: false,
              toggleTheme: false,
            },
          }}
        />
        {effectiveCanEdit && (
          <CardCanvasHistoryDrawer
            open={historyOpen}
            revisions={historyQuery.data ?? []}
            isLoading={historyQuery.isLoading}
            error={historyQuery.isError}
            isRestoring={restoreMutation.isPending}
            disabled={
              controller.isDirty ||
              controller.saveState === "conflict" ||
              !controller.isOnline
            }
            onClose={closeHistory}
            onRetry={() => void historyQuery.refetch()}
            onRestore={(revisionPublicId) =>
              void restoreRevision(revisionPublicId)
            }
          />
        )}
        {(controller.validationError !== null ||
          paste.isLoadingImages ||
          paste.imageLoadError) && (
          <div className="absolute bottom-3 left-1/2 z-30 flex w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-col gap-2">
            {controller.validationError && (
              <div
                className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 shadow-sm dark:border-red-900 dark:bg-red-950/60 dark:text-red-300"
                role="alert"
              >
                {t`This scene contains unsupported or unsafe content and cannot be saved.`}
              </div>
            )}
            {paste.isLoadingImages && (
              <div
                className="rounded-md border border-light-400 bg-light-50 px-3 py-2 text-xs text-light-800 shadow-sm dark:border-dark-500 dark:bg-dark-100 dark:text-dark-800"
                role="status"
              >
                {t`Loading whiteboard images…`}
              </div>
            )}
            {paste.imageLoadError && (
              <div
                className="flex items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow-sm dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
                role="alert"
              >
                <span>{t`Some whiteboard images could not be loaded.`}</span>
                <button
                  type="button"
                  onClick={() => void paste.refreshImages()}
                  className="min-h-11 shrink-0 rounded-md border border-amber-400 px-3 font-medium hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 dark:border-amber-800 dark:hover:bg-amber-900/50"
                >
                  {t`Try again`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <CardCanvasConflictDialog
        open={controller.saveState === "conflict"}
        remoteVersion={controller.conflictRemoteVersion}
        isLoadingRemote={controller.isLoadingRemote}
        onDownloadLocal={() => void exportCanvas("excalidraw")}
        onLoadRemote={() => void loadRemoteAfterConflict()}
      />
      <style jsx global>{`
        .kan-workspace-canvas [data-testid="toolbar-frame"],
        .kan-workspace-canvas [data-testid="toolbar-embeddable"],
        .kan-workspace-canvas [data-testid="toolbar-magicframe"] {
          display: none !important;
        }
        .kan-workspace-canvas .excalidraw,
        .kan-workspace-canvas .excalidraw .App-menu_top {
          --color-primary: ${resolvedTheme === "dark" ? "#f0f0f0" : "#202020"};
        }
      `}</style>
    </section>
  );
}
