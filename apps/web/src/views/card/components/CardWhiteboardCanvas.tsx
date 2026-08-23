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
import type {
  PipelineStageStatus,
  WorkspaceMemberOption,
} from "./subtask-types";
import { useLocalisation } from "~/hooks/useLocalisation";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import { getCardWorkspaceQueryValue } from "~/utils/card-workspace";
import { prepareCardCanvasConversion } from "./card-canvas-convert";
import {
  captureCardCanvasDocument,
  hasCardCanvasDocumentChanged,
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
import {
  hydrateCardCanvasImages,
  insertCardCanvasResource,
} from "./card-canvas-resources";
import { getFrameElements } from "./card-canvas-selection";
import { CardCanvasConflictDialog } from "./CardCanvasConflictDialog";
import { CardCanvasConvertDialog } from "./CardCanvasConvertDialog";
import { CardCanvasFrameOverlays } from "./CardCanvasFrameOverlays";
import { CardCanvasHistoryDrawer } from "./CardCanvasHistoryDrawer";
import { CardCanvasPasteUploadDialog } from "./CardCanvasPasteUploadDialog";
import { CardCanvasResourceDrawer } from "./CardCanvasResourceDrawer";
import { CardCanvasToolbar } from "./CardCanvasToolbar";
import { CardCanvasZonesDrawer } from "./CardCanvasZonesDrawer";
import { useCardCanvas } from "./use-card-canvas";
import { useCardCanvasImagePaste } from "./use-card-canvas-image-paste";

interface CardWhiteboardCanvasProps {
  cardPublicId: string;
  cardTitle: string;
  members: WorkspaceMemberOption[];
  canEdit: boolean;
  isPublicBoard: boolean;
  compact?: boolean;
  onClose?: () => void;
}

const FORBIDDEN_TOOLS = new Set(["image", "embeddable", "magicframe"]);
const INTERNAL_LINK_PATTERN = /^kan-(resource|subtask):[a-z0-9]{12}$/;

const getExcalidrawLanguage = (locale: string) => {
  const localeMap: Record<string, string> = {
    de: "de-DE",
    es: "es-ES",
    fr: "fr-FR",
    it: "it-IT",
    nl: "nl-NL",
    pl: "pl-PL",
    ptbr: "pt-BR",
    ru: "ru-RU",
  };
  return localeMap[locale] ?? "en";
};

export function CardWhiteboardCanvas({
  cardPublicId,
  cardTitle,
  members,
  canEdit,
  isPublicBoard,
  compact = false,
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
  const [zonesOpen, setZonesOpen] = useState(false);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [preparedConversion, setPreparedConversion] =
    useState<CardCanvasPreparedConversion | null>(null);
  const applyingSceneRef = useRef(false);
  const documentSnapshotRef = useRef<ReturnType<
    typeof captureCardCanvasDocument
  > | null>(null);
  const focusedFrameRef = useRef<string | null>(null);

  const controller = useCardCanvas({
    cardPublicId,
    userId: session?.user.id ?? null,
    canEdit,
  });
  const effectiveCanEdit = !controller.viewModeEnabled;
  const resourceQuery = api.cardResource.list.useQuery(
    { cardPublicId },
    { enabled: cardPublicId.length >= 12, retry: 1 },
  );
  const historyQuery = api.cardCanvas.listRevisions.useQuery(
    { cardPublicId },
    { enabled: effectiveCanEdit && historyOpen, retry: 1 },
  );
  const restoreMutation = api.cardCanvas.restore.useMutation();
  const convertMutation = api.cardCanvas.convertFrame.useMutation();
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
    onResourceCreated: insertUploadedImage,
  });

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
    (resourcePublicId: string) =>
      void replaceWorkspaceQuery("files", { recurso: resourcePublicId }),
    [replaceWorkspaceQuery],
  );
  const openSubtask = useCallback(
    (subtaskPublicId: string) =>
      void replaceWorkspaceQuery("subtasks", { subtask: subtaskPublicId }),
    [replaceWorkspaceQuery],
  );

  useEffect(() => {
    if (!excalidrawApi || !controller.scene || applyingSceneRef.current) return;
    applyingSceneRef.current = true;
    const appState = toExcalidrawAppState(controller.scene.appState);
    const elements = controller.scene
      .elements as unknown as ExcalidrawElement[];
    documentSnapshotRef.current = captureCardCanvasDocument(elements, appState);
    excalidrawApi.updateScene({
      elements,
      appState,
    });
    const clearHistory = excalidrawApi.history.clear as unknown as () => void;
    clearHistory();
    queueMicrotask(() => {
      applyingSceneRef.current = false;
    });
  }, [controller.scene, controller.sceneEpoch, excalidrawApi]);

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
      if (
        !hasCardCanvasDocumentChanged(
          documentSnapshotRef.current,
          elements,
          appState,
        )
      ) {
        return;
      }
      documentSnapshotRef.current = captureCardCanvasDocument(
        elements,
        appState,
      );
      if (FORBIDDEN_TOOLS.has(appState.activeTool.type)) {
        excalidrawApi.setActiveTool({ type: "selection" });
      }
      const adapted = toCardCanvasScene(elements, appState);
      if (adapted.changed) {
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
      setResourcesOpen(false);
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
      const link = parseCanvasInternalLink(
        element as unknown as Parameters<typeof parseCanvasInternalLink>[0],
      );
      if (!link) return null;
      const resource =
        link.kind === "resource" ? resourceByPublicId.get(link.publicId) : null;
      const subtask =
        link.kind === "subtask" ? subtaskByPublicId.get(link.publicId) : null;
      return (
        <button
          type="button"
          onDoubleClick={() =>
            link.kind === "resource"
              ? openResource(link.publicId)
              : openSubtask(link.publicId)
          }
          className="flex h-full w-full flex-col justify-between overflow-hidden rounded-md border border-light-400 bg-light-50 p-4 text-left text-light-1000 dark:border-dark-500 dark:bg-dark-100 dark:text-dark-1000"
        >
          <span className="text-[10px] font-medium text-light-600 dark:text-dark-600">
            {link.kind === "resource" ? t`Card resource` : t`Card subtask`}
          </span>
          <span className="line-clamp-3 text-sm font-semibold">
            {resource?.title ?? subtask?.title ?? t`Unavailable item`}
          </span>
          <span className="text-[10px] text-light-600 dark:text-dark-600">
            {t`Double-click to open`}
          </span>
        </button>
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
      id="card-view-whiteboard"
      role="tabpanel"
      aria-labelledby="card-tab-whiteboard"
      className={twMerge(
        "kan-card-canvas flex min-h-0 flex-col overflow-hidden bg-light-100 dark:bg-dark-50",
        compact
          ? "fixed inset-0 z-[130] h-[100dvh] w-screen"
          : "fixed inset-0 z-[130] h-[100dvh] w-screen md:relative md:inset-auto md:z-auto md:h-full md:w-full",
      )}
    >
      <CardCanvasToolbar
        cardTitle={cardTitle}
        saveState={controller.saveState}
        canEdit={effectiveCanEdit}
        onToggleZones={() => {
          setZonesOpen((current) => !current);
          setResourcesOpen(false);
          setHistoryOpen(false);
        }}
        onToggleResources={() => {
          setResourcesOpen((current) => !current);
          setZonesOpen(false);
          setHistoryOpen(false);
        }}
        onToggleHistory={() => {
          setHistoryOpen((current) => !current);
          setZonesOpen(false);
          setResourcesOpen(false);
        }}
        onConvert={beginConversion}
        onExport={(format) => void exportCanvas(format)}
        onExit={leaveWhiteboard}
      />
      <div
        ref={setCanvasContainer}
        className="relative min-h-0 flex-1"
        onPasteCapture={imagePaste.handlePasteCapture}
      >
        <Excalidraw
          excalidrawAPI={setExcalidrawApi}
          initialData={{
            elements: controller.scene
              .elements as unknown as ExcalidrawElement[],
            appState: toExcalidrawAppState(controller.scene.appState),
          }}
          onChange={handleSceneChange}
          onPaste={imagePaste.handleExcalidrawPaste}
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
          autoFocus={!compact}
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
          open={zonesOpen}
          frames={presentFrames}
          activeFramePublicId={routerFramePublicId ?? null}
          isLoading={controller.framesLoading}
          onClose={() => setZonesOpen(false)}
          onFocusFrame={focusFrame}
        />
        <CardCanvasResourceDrawer
          open={resourcesOpen}
          resources={resources}
          canEdit={effectiveCanEdit}
          isLoading={resourceQuery.isLoading}
          onClose={() => setResourcesOpen(false)}
          onInsert={(resource) => void insertResource(resource)}
          onOpenResource={openResource}
        />
        {effectiveCanEdit && (
          <CardCanvasHistoryDrawer
            open={historyOpen}
            revisions={historyQuery.data ?? []}
            isLoading={historyQuery.isLoading}
            isRestoring={restoreMutation.isPending}
            disabled={
              controller.isDirty ||
              controller.saveState === "conflict" ||
              !controller.isOnline
            }
            onClose={() => setHistoryOpen(false)}
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
