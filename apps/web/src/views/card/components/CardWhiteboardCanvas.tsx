import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import { useRouter } from "next/router";
import { Excalidraw } from "@excalidraw/excalidraw";
import { t } from "@lingui/core/macro";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HiArrowPath, HiOutlineExclamationTriangle } from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

import { authClient } from "@kan/auth/client";

import type { CardCanvasPreparedConversion } from "./card-canvas-convert";
import type { CardCanvasExportFormat } from "./card-canvas-export";
import type { CardCanvasSubtaskFields } from "./card-canvas-types";
import type { CardResource } from "./card-resource-types";
import type { CardWhiteboardCanvasProps } from "./card-whiteboard-canvas-types";
import type { PipelineStageStatus } from "./subtask-types";
import { useLocalisation } from "~/hooks/useLocalisation";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import { getCardWorkspaceQueryValue } from "~/utils/card-workspace";
import { prepareCardCanvasConversion } from "./card-canvas-convert";
import {
  captureCardCanvasDocument,
  hasCardCanvasDocumentChanged,
  seedCardCanvasDocumentSnapshot,
} from "./card-canvas-document-change";
import {
  findCanvasFrameByPublicId,
  parseCanvasInternalLink,
} from "./card-canvas-elements";
import {
  toCardCanvasScene,
  toExcalidrawAppState,
} from "./card-canvas-excalidraw-adapter";
import { exportCardCanvas } from "./card-canvas-export";
import { getExcalidrawLanguage } from "./card-canvas-localization";
import {
  hydrateCardCanvasImages,
  insertCardCanvasResource,
} from "./card-canvas-resources";
import { getFrameElements } from "./card-canvas-selection";
import { CardCanvasConflictDialog } from "./CardCanvasConflictDialog";
import { CardCanvasConvertDialog } from "./CardCanvasConvertDialog";
import { CardCanvasEmbeddable } from "./CardCanvasEmbeddable";
import { CardCanvasFrameOverlays } from "./CardCanvasFrameOverlays";
import { CardCanvasHistoryDrawer } from "./CardCanvasHistoryDrawer";
import { CardCanvasPasteUploadDialog } from "./CardCanvasPasteUploadDialog";
import { CardCanvasResourceDrawer } from "./CardCanvasResourceDrawer";
import { CardCanvasToolbar } from "./CardCanvasToolbar";
import { CardCanvasZonesDrawer } from "./CardCanvasZonesDrawer";
import { CardWebLinkDialog } from "./CardWebLinkDialog";
import { useCardCanvas } from "./use-card-canvas";
import { useCardCanvasDrawers } from "./use-card-canvas-drawers";
import { useCardCanvasImagePaste } from "./use-card-canvas-image-paste";
import { useCardCanvasPen } from "./use-card-canvas-pen";
import { useCardCanvasViewport } from "./use-card-canvas-viewport";
import { useCardCanvasWebLinks } from "./use-card-canvas-web-links";

const FORBIDDEN_TOOLS = new Set(["image", "embeddable", "magicframe"]);
const INTERNAL_LINK_PATTERN = /^kan-(resource|subtask):[a-z0-9]{12}$/;

export function CardWhiteboardCanvas({
  cardPublicId,
  cardTitle,
  members,
  canEdit,
  isPublicBoard,
  compact = false,
  embedded = false,
  isVisible = true,
  extended,
  onExtendedChange,
  onCanvasCreated,
  onClose,
}: CardWhiteboardCanvasProps) {
  const router = useRouter();
  const utils = api.useUtils();
  const { showPopup } = usePopup();
  const { resolvedTheme } = useTheme();
  const { locale } = useLocalisation();
  const { data: session } = authClient.useSession();
  const [excalidrawApi, setExcalidrawApi] =
    useState<ExcalidrawImperativeAPI | null>(null);
  const [canvasContainer, setCanvasContainer] = useState<HTMLDivElement | null>(
    null,
  );
  const [preparedConversion, setPreparedConversion] =
    useState<CardCanvasPreparedConversion | null>(null);
  const canvasSectionRef = useRef<HTMLElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const applyingSceneRef = useRef(false);
  const documentSnapshotRef = useRef<ReturnType<
    typeof captureCardCanvasDocument
  > | null>(null);
  const documentSnapshotKeyRef = useRef<string | null>(null);
  const focusedFrameRef = useRef<string | null>(null);
  const reportedCanvasRef = useRef(false);
  const penPreferenceKey = useMemo(
    () =>
      `kan:card-canvas:pen-mode:v1:${session?.user.id ?? "device"}:${cardPublicId}`,
    [cardPublicId, session?.user.id],
  );

  const controller = useCardCanvas({
    cardPublicId,
    userId: session?.user.id ?? null,
    canEdit,
  });
  const documentSnapshotKey = `${cardPublicId}:${controller.sceneEpoch}`;
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

  const effectiveCanEdit = !controller.viewModeEnabled;
  const pen = useCardCanvasPen({
    api: excalidrawApi,
    canEdit: effectiveCanEdit,
    preferenceKey: penPreferenceKey,
  });
  useCardCanvasViewport({
    api: excalidrawApi,
    sectionRef: canvasSectionRef,
    enabled: embedded && isVisible,
    layoutKey: extended,
  });

  useEffect(() => {
    if (controller.version <= 0 || reportedCanvasRef.current) return;
    reportedCanvasRef.current = true;
    onCanvasCreated?.();
    void utils.card.byId.invalidate({ cardPublicId });
  }, [cardPublicId, controller.version, onCanvasCreated, utils.card.byId]);
  const resourceQuery = api.cardResource.list.useQuery(
    { cardPublicId },
    { enabled: cardPublicId.length >= 12, retry: 1 },
  );
  const resources = useMemo(
    () => resourceQuery.data?.resources ?? [],
    [resourceQuery.data?.resources],
  );
  const presentFrames = useMemo(
    () => controller.frames.filter((frame) => frame.present),
    [controller.frames],
  );
  const resourceByPublicId = useMemo(
    () => new Map(resources.map((resource) => [resource.publicId, resource])),
    [resources],
  );
  const subtaskByPublicId = useMemo(
    () =>
      new Map(
        presentFrames.flatMap((frame) =>
          frame.subtask
            ? [[frame.subtask.publicId, frame.subtask] as const]
            : [],
        ),
      ),
    [presentFrames],
  );
  const insertUploadedImage = useCallback(
    async (resource: CardResource) => {
      if (!excalidrawApi) return;
      await insertCardCanvasResource(excalidrawApi, resource);
    },
    [excalidrawApi],
  );
  const imagePaste = useCardCanvasImagePaste({
    cardPublicId,
    canEdit: effectiveCanEdit,
    isPublicBoard,
    excalidrawApi,
    resources,
    onResourceCreated: insertUploadedImage,
  });
  const webLinks = useCardCanvasWebLinks({
    cardPublicId,
    canEdit: effectiveCanEdit,
    isPublicBoard,
    excalidrawApi,
  });
  const drawers = useCardCanvasDrawers({
    api: excalidrawApi,
    extended,
    hasOpenDialog:
      webLinks.isDialogOpen ||
      preparedConversion?.status === "ready" ||
      controller.saveState === "conflict" ||
      imagePaste.pendingPublicImage !== null,
    onExtendedChange,
  });
  const historyQuery = api.cardCanvas.listRevisions.useQuery(
    { cardPublicId },
    { enabled: effectiveCanEdit && drawers.historyOpen, retry: 1 },
  );
  const restoreMutation = api.cardCanvas.restore.useMutation();
  const convertMutation = api.cardCanvas.convertFrame.useMutation();
  const handleCanvasPaste = useCallback(
    (data: Parameters<typeof imagePaste.handleExcalidrawPaste>[0]) =>
      webLinks.handlePaste(data) ?? imagePaste.handleExcalidrawPaste(data),
    [imagePaste, webLinks],
  );

  useEffect(() => {
    if (!embedded || isVisible || !extended) return;
    onExtendedChange(false);
  }, [embedded, extended, isVisible, onExtendedChange]);

  const replaceWorkspaceQuery = useCallback(
    async (
      view: "summary" | "subtasks" | "whiteboard" | "files",
      extra: Record<string, string> = {},
    ) => {
      const nextQuery: Record<string, string | string[] | undefined> = {
        ...router.query,
        vista: getCardWorkspaceQueryValue(view),
        ...extra,
      };
      delete nextQuery.view;
      if (view !== "whiteboard") delete nextQuery.frame;
      if (view !== "subtasks") delete nextQuery.subtask;
      if (view !== "files") delete nextQuery.recurso;
      await router.replace(
        { pathname: router.pathname, query: nextQuery },
        undefined,
        { shallow: true },
      );
    },
    [router],
  );

  const leaveWhiteboard = () => {
    if (onClose) onClose();
    else void replaceWorkspaceQuery("summary");
  };
  const openResource = useCallback(
    (resourcePublicId: string) => {
      if (extended) onExtendedChange(false);
      void replaceWorkspaceQuery("files", { recurso: resourcePublicId });
    },
    [extended, onExtendedChange, replaceWorkspaceQuery],
  );
  const openSubtask = useCallback(
    (subtaskPublicId: string) => {
      if (extended) onExtendedChange(false);
      void replaceWorkspaceQuery("subtasks", { subtask: subtaskPublicId });
    },
    [extended, onExtendedChange, replaceWorkspaceQuery],
  );

  useEffect(() => {
    if (!excalidrawApi || !controller.scene || applyingSceneRef.current) return;
    applyingSceneRef.current = true;
    const appState = toExcalidrawAppState(controller.scene.appState);
    const elements = controller.scene
      .elements as unknown as ExcalidrawElement[];
    documentSnapshotRef.current = captureCardCanvasDocument(elements, appState);
    documentSnapshotKeyRef.current = documentSnapshotKey;
    excalidrawApi.updateScene({
      elements,
      appState,
    });
    const clearHistory = excalidrawApi.history.clear as unknown as () => void;
    clearHistory();
    queueMicrotask(() => {
      applyingSceneRef.current = false;
    });
  }, [controller.scene, documentSnapshotKey, excalidrawApi]);

  useEffect(() => {
    if (!excalidrawApi || resources.length === 0) return;
    void hydrateCardCanvasImages(excalidrawApi, resources).catch(() => {
      showPopup({
        header: t`Some images could not be loaded`,
        message: t`The whiteboard is safe. Open Files to verify the affected resource.`,
        icon: "error",
      });
    });
  }, [excalidrawApi, resources, showPopup]);

  const routerFramePublicId = Array.isArray(router.query.frame)
    ? router.query.frame[0]
    : router.query.frame;

  const focusFrame = useCallback(
    (framePublicId: string, updateUrl = true) => {
      if (!excalidrawApi) return;
      const frame = findCanvasFrameByPublicId(
        excalidrawApi.getSceneElements() as unknown as Parameters<
          typeof findCanvasFrameByPublicId
        >[0],
        framePublicId,
      );
      if (!frame) return;
      const excalidrawFrame = excalidrawApi
        .getSceneElements()
        .find((element) => element.id === frame.id);
      if (!excalidrawFrame) return;
      excalidrawApi.scrollToContent(excalidrawFrame, {
        fitToViewport: true,
        viewportZoomFactor: 0.78,
        animate: true,
        duration: 350,
      });
      focusedFrameRef.current = framePublicId;
      if (updateUrl) {
        const nextQuery = { ...router.query, frame: framePublicId };
        void router.replace(
          { pathname: router.pathname, query: nextQuery },
          undefined,
          { shallow: true },
        );
      }
    },
    [excalidrawApi, router],
  );

  useEffect(() => {
    if (
      !routerFramePublicId ||
      !excalidrawApi ||
      focusedFrameRef.current === routerFramePublicId
    ) {
      return;
    }
    focusFrame(routerFramePublicId, false);
  }, [excalidrawApi, focusFrame, routerFramePublicId, controller.sceneEpoch]);

  const handleSceneChange = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState) => {
      if (!excalidrawApi || applyingSceneRef.current) return;
      const linksRemoved = elements.some(
        (element) =>
          typeof element.link === "string" &&
          !INTERNAL_LINK_PATTERN.test(element.link),
      );
      const safeElements = linksRemoved
        ? elements.map((element) =>
            typeof element.link === "string" &&
            !INTERNAL_LINK_PATTERN.test(element.link)
              ? { ...element, link: null }
              : element,
          )
        : elements;
      if (
        !hasCardCanvasDocumentChanged(
          documentSnapshotRef.current,
          safeElements,
          appState,
        )
      ) {
        return;
      }
      documentSnapshotRef.current = captureCardCanvasDocument(
        safeElements,
        appState,
      );
      if (FORBIDDEN_TOOLS.has(appState.activeTool.type)) {
        excalidrawApi.setActiveTool({ type: "selection" });
      }
      const adapted = toCardCanvasScene(safeElements, appState);
      if (linksRemoved || adapted.changed) {
        applyingSceneRef.current = true;
        excalidrawApi.updateScene({
          elements: adapted.elements as unknown as ExcalidrawElement[],
        });
        queueMicrotask(() => {
          applyingSceneRef.current = false;
        });
      }
      controller.onSceneChange(adapted.scene);
    },
    [controller, excalidrawApi],
  );

  const insertResource = async (resource: CardResource) => {
    if (!excalidrawApi) return;
    try {
      await insertCardCanvasResource(excalidrawApi, resource);
      drawers.closeResources();
    } catch {
      showPopup({
        header: t`Resource could not be placed`,
        message: t`Open it from Files to verify it is still available.`,
        icon: "error",
      });
    }
  };

  const beginConversion = () => {
    if (!excalidrawApi) return;
    const prepared = prepareCardCanvasConversion(excalidrawApi);
    if (prepared.status === "invalid") {
      showPopup({
        header:
          prepared.reason === "multipleFrames"
            ? t`Select only one zone`
            : t`Select a zone or some elements`,
        message:
          prepared.reason === "multipleFrames"
            ? t`A subtask cannot span elements from several zones.`
            : t`A loose selection will be wrapped in a new zone before conversion.`,
        icon: "error",
      });
      return;
    }
    setPreparedConversion(prepared);
  };

  const submitConversion = async (
    targetStageStatus: PipelineStageStatus,
    subtaskFields: CardCanvasSubtaskFields,
  ) => {
    if (
      !excalidrawApi ||
      !preparedConversion ||
      preparedConversion.status !== "ready"
    ) {
      return;
    }
    try {
      const adapted = toCardCanvasScene(
        excalidrawApi.getSceneElements(),
        excalidrawApi.getAppState(),
      );
      const normalized = await controller.normalizeScene(adapted.scene);
      const result = await convertMutation.mutateAsync({
        cardPublicId,
        framePublicId: preparedConversion.framePublicId,
        expectedVersion: controller.version,
        scene: normalized.scene,
        targetStageStatus,
        subtaskFields,
      });
      if (result.status === "conflict") {
        controller.reportConflict(result.remoteVersion);
        setPreparedConversion(null);
        return;
      }
      await controller.acceptExternalSave(result);
      setPreparedConversion(null);
      await Promise.all([
        controller.refetchFrames(),
        utils.cardPipeline.get.invalidate({ cardPublicId }),
        utils.card.byId.invalidate({ cardPublicId }),
        utils.board.byId.invalidate(),
      ]);
      focusFrame(result.framePublicId);
      showPopup({
        header: t`Subtask created`,
        message: t`The zone now keeps the subtask's live status and progress.`,
        icon: "success",
      });
    } catch {
      showPopup({
        header: t`Zone could not be converted`,
        message: t`Nothing was created. Review the fields and try again.`,
        icon: "error",
      });
    }
  };

  const restoreRevision = async (revisionPublicId: string) => {
    try {
      const result = await restoreMutation.mutateAsync({
        cardPublicId,
        revisionPublicId,
        expectedVersion: controller.version,
      });
      if (result.status === "conflict") {
        controller.reportConflict(result.remoteVersion);
        return;
      }
      await controller.loadRemoteVersion();
      await Promise.all([
        historyQuery.refetch(),
        controller.refetchFrames(),
        utils.card.byId.invalidate({ cardPublicId }),
      ]);
      showPopup({
        header: t`Revision restored`,
        message: t`The previous head was preserved as a checkpoint.`,
        icon: "success",
      });
    } catch {
      showPopup({
        header: t`Revision could not be restored`,
        message: t`The current whiteboard was not changed.`,
        icon: "error",
      });
    }
  };

  const getExportElementIds = () => {
    if (!excalidrawApi) return undefined;
    const selectedIds = Object.keys(
      excalidrawApi.getAppState().selectedElementIds,
    );
    if (selectedIds.length === 0) return undefined;
    const selectedFrame = excalidrawApi
      .getSceneElements()
      .find(
        (element) =>
          selectedIds.includes(element.id) && element.type === "frame",
      );
    if (!selectedFrame) return selectedIds;
    return getFrameElements(
      excalidrawApi.getSceneElements() as unknown as Parameters<
        typeof getFrameElements
      >[0],
      selectedFrame.id,
    ).map((element) => element.id);
  };

  const exportCanvas = async (
    format: CardCanvasExportFormat,
    useSelection = true,
  ) => {
    if (!excalidrawApi) return;
    try {
      await exportCardCanvas({
        api: excalidrawApi,
        title: cardTitle,
        format,
        ...(useSelection && { elementIds: getExportElementIds() }),
        resourceTitles: new Map(
          resources.map((resource) => [resource.publicId, resource.title]),
        ),
        subtaskTitles: new Map(
          presentFrames.flatMap((frame) =>
            frame.subtask
              ? [[frame.subtask.publicId, frame.subtask.title] as const]
              : [],
          ),
        ),
      });
    } catch {
      showPopup({
        header: t`Whiteboard could not be exported`,
        message: t`Select at least one visible element and try again.`,
        icon: "error",
      });
    }
  };

  const renderEmbeddable = useCallback(
    (element: { link: string | null }) => {
      return (
        <CardCanvasEmbeddable
          element={element}
          resources={resourceByPublicId}
          subtasks={subtaskByPublicId}
          onOpenResource={openResource}
          onOpenSubtask={openSubtask}
        />
      );
    },
    [openResource, openSubtask, resourceByPublicId, subtaskByPublicId],
  );

  if (controller.error) {
    return (
      <div className="flex h-full min-h-[24rem] items-center justify-center bg-light-100 p-6 text-center dark:bg-dark-50">
        <div>
          <HiOutlineExclamationTriangle className="mx-auto h-7 w-7 text-red-600 dark:text-red-400" />
          <p className="mt-3 text-sm font-medium text-light-1000 dark:text-dark-1000">{t`Whiteboard could not be loaded`}</p>
          <button
            type="button"
            onClick={() => void controller.refetchHead()}
            className="mt-3 inline-flex items-center gap-2 rounded-md border border-light-500 px-3 py-2 text-xs font-medium text-light-900 hover:bg-light-200 dark:border-dark-500 dark:text-dark-900 dark:hover:bg-dark-200"
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
        className="flex h-full min-h-[24rem] items-center justify-center bg-light-100 dark:bg-dark-50"
        role="status"
      >
        <div className="flex items-center gap-2 text-sm text-light-700 dark:text-dark-700">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-light-400 border-t-light-900 dark:border-dark-400 dark:border-t-dark-900" />
          {t`Opening whiteboard…`}
        </div>
      </div>
    );
  }

  return (
    <section
      ref={canvasSectionRef}
      id={embedded ? undefined : "card-view-whiteboard"}
      role={embedded ? "region" : "tabpanel"}
      aria-label={embedded ? t`Whiteboard canvas` : undefined}
      aria-labelledby={embedded ? undefined : "card-tab-whiteboard"}
      onKeyDownCapture={drawers.handleKeyDownCapture}
      className={twMerge(
        "kan-card-canvas flex min-h-0 flex-col overflow-hidden bg-light-100 dark:bg-dark-50",
        embedded
          ? extended
            ? "relative h-full w-full"
            : "relative h-[68dvh] max-h-[52rem] min-h-[24rem] w-full scroll-mt-16"
          : compact
            ? "fixed inset-0 z-[130] h-[100dvh] w-screen"
            : "fixed inset-0 z-[130] h-[100dvh] w-screen md:relative md:inset-auto md:z-auto md:h-full md:w-full",
        !isVisible && "hidden",
      )}
    >
      <CardCanvasToolbar
        cardTitle={extended || !embedded ? cardTitle : undefined}
        saveState={controller.saveState}
        canEdit={effectiveCanEdit}
        onToggleZones={drawers.toggleZones}
        onToggleResources={drawers.toggleResources}
        onToggleHistory={drawers.toggleHistory}
        onConvert={beginConversion}
        onAddImage={
          effectiveCanEdit ? () => imageInputRef.current?.click() : undefined
        }
        imageImportDisabled={imagePaste.isImageImportBusy}
        onAddLink={effectiveCanEdit ? () => webLinks.openDialog() : undefined}
        onTogglePenMode={effectiveCanEdit ? pen.toggle : undefined}
        onExport={(format) => void exportCanvas(format)}
        onExit={embedded ? undefined : leaveWhiteboard}
        onToggleExtended={
          embedded ? () => onExtendedChange(!extended) : undefined
        }
        extended={extended}
        penModeEnabled={pen.enabled}
        zonesOpen={drawers.zonesOpen}
        resourcesOpen={drawers.resourcesOpen}
        historyOpen={drawers.historyOpen}
      />
      <div
        ref={setCanvasContainer}
        className="relative min-h-0 flex-1"
        onPasteCapture={imagePaste.handlePasteCapture}
        onDragOverCapture={imagePaste.handleDragOverCapture}
        onDropCapture={imagePaste.handleDropCapture}
        onPointerDownCapture={pen.handlePointerDownCapture}
      >
        {effectiveCanEdit && (
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            disabled={imagePaste.isImageImportBusy}
            tabIndex={-1}
            className="sr-only"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) imagePaste.importImageFile(file);
            }}
          />
        )}
        <Excalidraw
          excalidrawAPI={setExcalidrawApi}
          initialData={{
            elements: controller.scene
              .elements as unknown as ExcalidrawElement[],
            appState: toExcalidrawAppState(controller.scene.appState),
          }}
          onChange={handleSceneChange}
          onPaste={handleCanvasPaste}
          onLinkOpen={(element, event) => {
            const link = parseCanvasInternalLink(
              element as unknown as Parameters<
                typeof parseCanvasInternalLink
              >[0],
            );
            if (!link) return;
            event.preventDefault();
            if (link.kind === "resource") openResource(link.publicId);
            else openSubtask(link.publicId);
          }}
          validateEmbeddable={(link) => INTERNAL_LINK_PATTERN.test(link)}
          renderEmbeddable={renderEmbeddable}
          viewModeEnabled={!effectiveCanEdit}
          aiEnabled={false}
          theme={resolvedTheme === "dark" ? "dark" : "light"}
          langCode={getExcalidrawLanguage(locale)}
          autoFocus={!compact && !embedded}
          detectScroll={false}
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
        <CardCanvasFrameOverlays
          api={excalidrawApi}
          container={canvasContainer}
          frames={presentFrames}
          onOpenSubtask={openSubtask}
        />
        <CardCanvasZonesDrawer
          open={drawers.zonesOpen}
          frames={presentFrames}
          activeFramePublicId={routerFramePublicId ?? null}
          isLoading={controller.framesLoading}
          onClose={drawers.closeZones}
          onFocusFrame={focusFrame}
        />
        <CardCanvasResourceDrawer
          open={drawers.resourcesOpen}
          resources={resources}
          canEdit={effectiveCanEdit}
          isLoading={resourceQuery.isLoading}
          onClose={drawers.closeResources}
          onInsert={(resource) => void insertResource(resource)}
          onOpenResource={openResource}
        />
        {effectiveCanEdit && (
          <CardCanvasHistoryDrawer
            open={drawers.historyOpen}
            revisions={historyQuery.data ?? []}
            isLoading={historyQuery.isLoading}
            isRestoring={restoreMutation.isPending}
            disabled={
              controller.isDirty ||
              controller.saveState === "conflict" ||
              !controller.isOnline
            }
            onClose={drawers.closeHistory}
            onRestore={(revisionPublicId) =>
              void restoreRevision(revisionPublicId)
            }
          />
        )}
        {controller.validationError && (
          <div className="absolute bottom-3 left-1/2 z-30 max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 shadow-sm dark:border-red-900 dark:bg-red-950/60 dark:text-red-300">
            {t`This scene contains unsupported or unsafe content and cannot be saved.`}
          </div>
        )}
      </div>
      <CardCanvasConvertDialog
        open={preparedConversion?.status === "ready"}
        defaultTitle={
          preparedConversion?.status === "ready" ? preparedConversion.title : ""
        }
        members={members}
        isSaving={convertMutation.isPending}
        onClose={() => setPreparedConversion(null)}
        onSubmit={(status, fields) => void submitConversion(status, fields)}
      />
      <CardCanvasConflictDialog
        open={controller.saveState === "conflict"}
        remoteVersion={controller.conflictRemoteVersion}
        isLoadingRemote={controller.isLoadingRemote}
        onDownloadLocal={() => void exportCanvas("excalidraw", false)}
        onLoadRemote={() => void controller.loadRemoteVersion()}
      />
      <CardCanvasPasteUploadDialog
        open={imagePaste.pendingPublicImage !== null}
        filename={imagePaste.pendingPublicImage?.name ?? t`Image`}
        isUploading={imagePaste.isUploadingPaste}
        onCancel={imagePaste.cancelPublicImage}
        onConfirm={imagePaste.confirmPublicImage}
      />
      <CardWebLinkDialog
        cardPublicId={cardPublicId}
        isOpen={webLinks.isDialogOpen}
        initialUrl={webLinks.initialUrl}
        onCreated={webLinks.insertCreatedWebLink}
        onClose={webLinks.closeDialog}
      />
      <style jsx global>{`
        .kan-card-canvas [data-testid="toolbar-embeddable"],
        .kan-card-canvas [data-testid="toolbar-magicframe"] {
          display: none !important;
        }
        .kan-card-canvas .excalidraw,
        .kan-card-canvas .excalidraw .App-menu_top {
          --color-primary: ${resolvedTheme === "dark" ? "#f0f0f0" : "#202020"};
        }
      `}</style>
    </section>
  );
}
