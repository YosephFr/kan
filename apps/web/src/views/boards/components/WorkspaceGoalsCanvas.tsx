import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import { Excalidraw } from "@excalidraw/excalidraw";
import { t } from "@lingui/core/macro";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { authClient } from "@kan/auth/client";

import type { WorkspaceCanvasImageViewportSnapshot } from "./workspace-canvas-image-loader";
import type { WorkspaceGoalsCanvasProps } from "./WorkspaceGoalsCanvasStatus";
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
import { useWorkspaceCanvasImages } from "./use-workspace-canvas-images";
import { useWorkspaceCanvasPaste } from "./use-workspace-canvas-paste";
import { getWorkspaceCanvasImagePublicIds } from "./workspace-canvas-image-ids";
import { createWorkspaceCanvasImageViewportScheduler } from "./workspace-canvas-image-loader";
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
import {
  WorkspaceGoalsCanvasLoadState,
  WorkspaceGoalsCanvasStatus,
  WorkspaceGoalsCanvasThemeStyle,
} from "./WorkspaceGoalsCanvasStatus";
import { WorkspaceGoalsToolbar } from "./WorkspaceGoalsToolbar";

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
  const imageViewportSchedulerRef = useRef<ReturnType<
    typeof createWorkspaceCanvasImageViewportScheduler
  > | null>(null);
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
  const workspaceImages = useWorkspaceCanvasImages({
    workspacePublicId,
    imagePublicIds,
    canvasApi: excalidrawApi,
  });
  const updateWorkspaceImagesViewport = workspaceImages.updateViewport;
  const retryWorkspaceImages = workspaceImages.retryFailed;
  const paste = useWorkspaceCanvasPaste({
    workspacePublicId,
    knownUsageBytes: workspaceImages.knownUsageBytes,
    quotaBytes: workspaceImages.quotaBytes,
    canvasApi: excalidrawApi,
    canEdit: effectiveCanEdit,
    onImagesChanged: retryWorkspaceImages,
  });

  useEffect(() => {
    const scheduler = createWorkspaceCanvasImageViewportScheduler({
      onFrame: ({ elements, appState }) =>
        updateWorkspaceImagesViewport(elements, appState),
      requestFrame: window.requestAnimationFrame.bind(window),
      cancelFrame: window.cancelAnimationFrame.bind(window),
    });
    imageViewportSchedulerRef.current = scheduler;
    return () => {
      scheduler.dispose();
      if (imageViewportSchedulerRef.current === scheduler) {
        imageViewportSchedulerRef.current = null;
      }
    };
  }, [updateWorkspaceImagesViewport]);

  const scheduleWorkspaceImagesViewport = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState) => {
      const snapshot: WorkspaceCanvasImageViewportSnapshot = {
        elements,
        appState,
      };
      imageViewportSchedulerRef.current?.schedule(snapshot);
    },
    [],
  );

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
    const appState = {
      ...excalidrawApi.getAppState(),
      scrollX: home.scrollX,
      scrollY: home.scrollY,
      zoom: home.zoom,
    };
    applyingSceneRef.current = true;
    excalidrawApi.updateScene({
      appState,
    });
    updateWorkspaceImagesViewport(excalidrawApi.getSceneElements(), appState);
    queueMicrotask(() => {
      applyingSceneRef.current = false;
    });
  }, [excalidrawApi, updateWorkspaceImagesViewport]);

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
      updateWorkspaceImagesViewport(
        excalidrawApi.getSceneElements(),
        excalidrawApi.getAppState(),
      );
    };
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(refresh);
    observer?.observe(sectionRef.current);
    return () => observer?.disconnect();
  }, [applyViewportBounds, excalidrawApi, updateWorkspaceImagesViewport]);

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
      scheduleWorkspaceImagesViewport(elements, appState);
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
    [
      applyViewportBounds,
      controller,
      documentSnapshotKey,
      excalidrawApi,
      scheduleWorkspaceImagesViewport,
    ],
  );

  const exportCanvas = useCallback(
    async (format: CardCanvasExportFormat) => {
      if (!excalidrawApi) return;
      const exportStage = { imagesLoaded: false };
      const selectedElementIds = Object.keys(
        excalidrawApi.getAppState().selectedElementIds,
      );
      const selectedElementIdSet = new Set(selectedElementIds);
      const exportElements =
        selectedElementIds.length > 0
          ? excalidrawApi
              .getSceneElements()
              .filter((element) => selectedElementIdSet.has(element.id))
          : excalidrawApi.getSceneElements();
      const exportImagePublicIds = [
        ...getWorkspaceCanvasImagePublicIds(exportElements),
      ];
      try {
        await workspaceImages.withAllImages(async (files) => {
          exportStage.imagesLoaded = true;
          await exportCardCanvas({
            api: excalidrawApi,
            files,
            title: t`Vision and goals for ${workspaceName}`,
            format,
            elementIds:
              selectedElementIds.length > 0 ? selectedElementIds : undefined,
            maxImageDimension: WORKSPACE_CANVAS_EXPORT_MAX_DIMENSION,
            resourceTitles: new Map(),
            subtaskTitles: new Map(),
          });
        }, exportImagePublicIds);
      } catch (error) {
        const memoryLimitReached =
          error instanceof Error &&
          error.message === "WORKSPACE_CANVAS_EXPORT_MEMORY_LIMIT";
        showPopup({
          header: memoryLimitReached
            ? t`Too many images for one export`
            : exportStage.imagesLoaded
              ? t`Whiteboard could not be exported`
              : t`Whiteboard images could not be loaded`,
          message: memoryLimitReached
            ? t`Select a smaller area of the whiteboard and export it separately.`
            : exportStage.imagesLoaded
              ? t`Add at least one visible element and try again.`
              : t`Check your connection, retry the failed images and export again.`,
          icon: "error",
        });
      }
    },
    [excalidrawApi, showPopup, workspaceImages, workspaceName],
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
      retryWorkspaceImages();
    } catch {
      showPopup({
        header: t`Remote whiteboard loaded`,
        message: t`Some unused local images could not be cleaned up. Your whiteboard content is safe.`,
        icon: "error",
      });
    }
    return true;
  }, [controller, excalidrawApi, paste, showPopup, retryWorkspaceImages]);

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

  if (controller.error || controller.isLoading || !controller.scene) {
    return (
      <WorkspaceGoalsCanvasLoadState
        error={Boolean(controller.error)}
        onRetry={() => void controller.retryInitialLoad()}
      />
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
          key={workspacePublicId}
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
        <WorkspaceGoalsCanvasStatus
          validationError={controller.validationError !== null}
          imagesLoading={workspaceImages.isLoading}
          imagesLoaded={workspaceImages.loaded}
          imagesTotal={workspaceImages.total}
          imageLoadError={workspaceImages.imageLoadError}
          failedImageCount={paste.failedImageCount}
          pasteBusy={paste.isBusy}
          online={controller.isOnline}
          onRetryImages={retryWorkspaceImages}
          onRetryFailedPaste={paste.retryFailedImages}
        />
      </div>
      <CardCanvasConflictDialog
        open={controller.saveState === "conflict"}
        remoteVersion={controller.conflictRemoteVersion}
        isLoadingRemote={controller.isLoadingRemote}
        onDownloadLocal={() => void exportCanvas("excalidraw")}
        onLoadRemote={() => void loadRemoteAfterConflict()}
      />
      <WorkspaceGoalsCanvasThemeStyle dark={resolvedTheme === "dark"} />
    </section>
  );
}
