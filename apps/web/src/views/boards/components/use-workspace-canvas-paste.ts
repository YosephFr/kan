import type { ClipboardData } from "@excalidraw/excalidraw/clipboard";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type {
  ClipboardEvent as ReactClipboardEvent,
  DragEvent as ReactDragEvent,
} from "react";
import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { RouterOutputs } from "~/utils/api";
import type { CardResource } from "~/views/card/components/card-resource-types";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import {
  getCardCanvasClipboardInputFromDataTransfer,
  isCardCanvasInternalClipboard,
  normalizeCardCanvasClipboard,
  readCardCanvasClipboardItems,
} from "~/views/card/components/card-canvas-clipboard";
import { consumeCardCanvasExternalPaste } from "~/views/card/components/card-canvas-clipboard-operation";
import {
  getCardCanvasImageFiles,
  getCardCanvasNativePasteAction,
  hasCardCanvasImageDragItem,
} from "~/views/card/components/card-canvas-image-import";
import {
  assertCardCanvasPasteInputBudget,
  insertCardCanvasPasteBatch,
} from "~/views/card/components/card-canvas-paste-batch";
import {
  hydrateCardCanvasImages,
  preflightCardCanvasImageFile,
} from "~/views/card/components/card-canvas-resources";
import {
  hashResourceFile,
  uploadResourceFile,
} from "~/views/card/components/resource-upload-queue";
import {
  toWorkspaceCanvasPasteText,
  validateWorkspaceCanvasImageFile,
} from "./workspace-canvas-paste";
import { constrainWorkspaceCanvasSelection } from "./workspace-canvas-vertical-track";

type WorkspaceCanvasImage =
  RouterOutputs["workspaceCanvas"]["listImages"]["images"][number];

export function useWorkspaceCanvasPaste({
  workspacePublicId,
  imagePublicIds,
  canvasApi,
  canEdit,
}: {
  workspacePublicId: string;
  imagePublicIds: readonly string[];
  canvasApi: ExcalidrawImperativeAPI | null;
  canEdit: boolean;
}) {
  const { showPopup } = usePopup();
  const utils = api.useUtils();
  const [isBusy, setIsBusy] = useState(false);
  const [hydrationFailed, setHydrationFailed] = useState(false);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const workspaceRef = useRef(workspacePublicId);
  const abortRef = useRef<AbortController | null>(null);
  const hydrationFailureRef = useRef<string | null>(null);
  const imagesQuery = api.workspaceCanvas.listImages.useQuery(
    { workspacePublicId, imagePublicIds: [...imagePublicIds] },
    {
      enabled: workspacePublicId.length === 12 && imagePublicIds.length > 0,
      retry: 1,
    },
  );
  const createUpload = api.workspaceCanvas.createImageUpload.useMutation();
  const confirmUpload = api.workspaceCanvas.confirmImageUpload.useMutation();
  const importRemoteImage = api.workspaceCanvas.importRemoteImage.useMutation();
  const deleteImage = api.workspaceCanvas.deleteImage.useMutation();
  const images: CardResource[] = useMemo(
    () => (imagePublicIds.length > 0 ? (imagesQuery.data?.images ?? []) : []),
    [imagePublicIds, imagesQuery.data?.images],
  );
  const showBusyPopup = useCallback(
    () =>
      showPopup({
        header: t`Paste is still in progress`,
        message: t`Wait for the current images to finish before adding more content.`,
        icon: "error",
      }),
    [showPopup],
  );

  useEffect(() => {
    if (!canvasApi || !imagesQuery.data || imagePublicIds.length === 0) return;
    const hydrationKey = `${workspacePublicId}:${imagesQuery.data.images
      .map((image) => image.publicId)
      .join(",")}`;
    const returnedPublicIds = new Set(
      imagesQuery.data.images.map((image) => image.publicId),
    );
    void (async () => {
      try {
        if (
          imagePublicIds.some((publicId) => !returnedPublicIds.has(publicId))
        ) {
          throw new Error("WORKSPACE_CANVAS_IMAGE_MISSING");
        }
        await hydrateCardCanvasImages(canvasApi, imagesQuery.data.images);
        if (!mountedRef.current) return;
        hydrationFailureRef.current = null;
        setHydrationFailed(false);
      } catch {
        if (!mountedRef.current) return;
        setHydrationFailed(true);
        if (hydrationFailureRef.current === hydrationKey) return;
        hydrationFailureRef.current = hydrationKey;
        showPopup({
          header: t`Some whiteboard images could not be loaded`,
          message: t`Your ideas remain saved. Check your connection and try reopening this workspace.`,
          icon: "error",
        });
      }
    })();
  }, [
    canvasApi,
    imagePublicIds,
    imagesQuery.data,
    showPopup,
    workspacePublicId,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    workspaceRef.current = workspacePublicId;
    setHydrationFailed(false);
    hydrationFailureRef.current = null;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, [workspacePublicId]);

  const uploadFile = useCallback(
    async (file: File, knownImages: readonly CardResource[]) => {
      if (!canvasApi || !canEdit || !navigator.onLine) {
        throw new Error("WORKSPACE_CANVAS_IMAGE_UNAVAILABLE");
      }
      const contentType = validateWorkspaceCanvasImageFile(file);
      await preflightCardCanvasImageFile({
        file,
        contentType,
        api: canvasApi,
        resources: [...knownImages],
      });
      const sha256 = await hashResourceFile(file);
      const session = await createUpload.mutateAsync({
        workspacePublicId,
        filename: file.name,
        contentType,
        size: file.size,
        sha256,
      });
      const abortController = new AbortController();
      abortRef.current = abortController;
      try {
        await uploadResourceFile(
          session.url,
          file,
          contentType,
          abortController.signal,
          () => undefined,
        );
        return await confirmUpload.mutateAsync({
          workspacePublicId,
          uploadSessionPublicId: session.uploadSessionPublicId,
        });
      } finally {
        abortRef.current = null;
      }
    },
    [canEdit, canvasApi, confirmUpload, createUpload, workspacePublicId],
  );

  const processClipboard = useCallback(
    async (input: ReturnType<typeof normalizeCardCanvasClipboard>) => {
      if (!canvasApi || !canEdit) return;
      const operationWorkspacePublicId = workspacePublicId;
      const shouldContinue = () =>
        mountedRef.current &&
        workspaceRef.current === operationWorkspacePublicId;
      const online = navigator.onLine;
      const processableItems = online
        ? input.items
        : input.items.filter((item) => item.type !== "image");
      const offlineImageCount = online
        ? 0
        : input.items.filter((item) => item.type === "image").length;
      const localImageSizes = processableItems.flatMap((item) =>
        item.type === "image" && item.source === "file" ? [item.file.size] : [],
      );
      if (
        processableItems.some((item) => item.type === "image") &&
        imagePublicIds.length > 0 &&
        !imagesQuery.data
      ) {
        throw new Error("WORKSPACE_CANVAS_IMAGES_NOT_READY");
      }
      assertCardCanvasPasteInputBudget({
        elements: canvasApi.getSceneElements(),
        objectCount: processableItems.length,
        imageSizes: localImageSizes,
        resources: images,
      });

      const createdImages: WorkspaceCanvasImage[] = [];
      const pasteItems: (
        | { kind: "text"; text: string }
        | { kind: "resource"; resource: WorkspaceCanvasImage }
      )[] = [];
      let skippedImages = input.imagesOmitted ? 1 : offlineImageCount;
      for (const item of processableItems) {
        if (!shouldContinue()) break;
        if (item.type === "text" || item.type === "link") {
          pasteItems.push({
            kind: "text",
            text: toWorkspaceCanvasPasteText(item),
          });
          continue;
        }
        try {
          const resource =
            item.source === "file"
              ? await uploadFile(item.file, [...images, ...createdImages])
              : await importRemoteImage.mutateAsync({
                  workspacePublicId,
                  url: item.url,
                });
          createdImages.push(resource);
          if (!shouldContinue()) break;
          pasteItems.push({ kind: "resource", resource });
        } catch {
          if (!shouldContinue()) break;
          skippedImages += 1;
        }
      }
      try {
        if (!shouldContinue()) {
          await Promise.allSettled(
            createdImages.map((image) =>
              deleteImage.mutateAsync({
                workspacePublicId: operationWorkspacePublicId,
                imagePublicId: image.publicId,
              }),
            ),
          );
          return;
        }
        if (pasteItems.length > 0) {
          await insertCardCanvasPasteBatch({
            api: canvasApi,
            items: pasteItems,
            resources: [...images, ...createdImages],
            transformElements: (elements, selectedElementIds) => {
              if (!shouldContinue()) {
                throw new Error("WORKSPACE_CANVAS_PASTE_CANCELLED");
              }
              return constrainWorkspaceCanvasSelection(
                elements,
                selectedElementIds,
              ).elements;
            },
          });
        }
      } catch (error) {
        await Promise.allSettled(
          createdImages.map((image) =>
            deleteImage.mutateAsync({
              workspacePublicId,
              imagePublicId: image.publicId,
            }),
          ),
        );
        throw error;
      }
      if (createdImages.length > 0 && shouldContinue()) {
        await utils.workspaceCanvas.listImages.invalidate({
          workspacePublicId,
          imagePublicIds: [...imagePublicIds],
        });
      }
      if (skippedImages > 0 && shouldContinue()) {
        showPopup({
          header:
            pasteItems.length > 0
              ? t`Some images were skipped`
              : t`Images could not be added`,
          message: navigator.onLine
            ? t`Use JPEG, PNG or WebP images within the whiteboard limits.`
            : t`Text was kept editable. Images need a connection so they can be stored securely.`,
          icon: pasteItems.length > 0 ? "success" : "error",
        });
      }
    },
    [
      canEdit,
      canvasApi,
      deleteImage,
      images,
      imagePublicIds,
      imagesQuery.data,
      importRemoteImage,
      showPopup,
      uploadFile,
      utils.workspaceCanvas.listImages,
      workspacePublicId,
    ],
  );

  const run = useCallback(
    (operation: () => Promise<void>) => {
      if (busyRef.current) {
        showBusyPopup();
        return;
      }
      busyRef.current = true;
      setIsBusy(true);
      void Promise.resolve()
        .then(operation)
        .catch(() => {
          if (!mountedRef.current) return;
          showPopup({
            header: t`Clipboard content could not be pasted`,
            message: t`The content was not changed. Check the whiteboard limits and try again.`,
            icon: "error",
          });
        })
        .finally(() => {
          busyRef.current = false;
          if (mountedRef.current) setIsBusy(false);
        });
    },
    [showBusyPopup, showPopup],
  );

  const pasteFromClipboard = useCallback(() => {
    if (!canEdit) return;
    run(async () => {
      const clipboard = navigator.clipboard as {
        read?: Clipboard["read"];
        readText: Clipboard["readText"];
      };
      const includeImages = navigator.onLine;
      const input = clipboard.read
        ? await readCardCanvasClipboardItems(await clipboard.read(), {
            includeImages,
          })
        : { text: await clipboard.readText() };
      const normalized = normalizeCardCanvasClipboard(input, {
        includeImages,
      });
      if (normalized.items.length === 0) throw new Error("EMPTY_CLIPBOARD");
      await processClipboard(normalized);
    });
  }, [canEdit, processClipboard, run]);

  const handlePasteCapture = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>) => {
      if (!canEdit || canvasApi?.getAppState().editingTextElement) return;
      try {
        const includeImages = navigator.onLine;
        const input = getCardCanvasClipboardInputFromDataTransfer(
          event.clipboardData,
          { includeImages },
        );
        if (isCardCanvasInternalClipboard(input)) return;
        consumeCardCanvasExternalPaste(event);
        run(() =>
          processClipboard(
            normalizeCardCanvasClipboard(input, { includeImages }),
          ),
        );
      } catch {
        consumeCardCanvasExternalPaste(event);
        showPopup({
          header: t`Clipboard content could not be pasted`,
          message: t`The clipboard content exceeded the safe whiteboard limits.`,
          icon: "error",
        });
      }
    },
    [canEdit, canvasApi, processClipboard, run, showPopup],
  );

  const importFiles = useCallback(
    (files: File[]) => {
      if (!canEdit || files.length === 0) return;
      run(() =>
        processClipboard(
          normalizeCardCanvasClipboard({
            images: files.map((file) => ({ file })),
          }),
        ),
      );
    },
    [canEdit, processClipboard, run],
  );

  const handleDragOverCapture = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      if (!canEdit || !hasCardCanvasImageDragItem(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    [canEdit],
  );

  const handleDropCapture = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      if (!canEdit) return;
      const files = getCardCanvasImageFiles(event.dataTransfer.files);
      if (files.length === 0) return;
      consumeCardCanvasExternalPaste(event);
      importFiles(files);
    },
    [canEdit, importFiles],
  );

  const handleExcalidrawPaste = useCallback(
    (data: ClipboardData) => {
      const action = getCardCanvasNativePasteAction({
        currentElementCount: canvasApi?.getSceneElements().length ?? 0,
        elements: data.elements,
        files: data.files,
      });
      if (action === "continue") return true;
      showPopup({
        header: t`Paste the source image instead`,
        message: t`Workspace images must pass secure storage before they enter the whiteboard.`,
        icon: "error",
      });
      return false;
    },
    [canvasApi, showPopup],
  );

  const deleteUnusedImages = useCallback(
    async (publicIds: readonly string[]) => {
      if (publicIds.length === 0) return;
      await Promise.allSettled(
        publicIds.map((imagePublicId) =>
          deleteImage.mutateAsync({ workspacePublicId, imagePublicId }),
        ),
      );
      await utils.workspaceCanvas.listImages.invalidate({
        workspacePublicId,
        imagePublicIds: [...imagePublicIds],
      });
    },
    [
      deleteImage,
      imagePublicIds,
      utils.workspaceCanvas.listImages,
      workspacePublicId,
    ],
  );

  const refreshImages = useCallback(async () => {
    setHydrationFailed(false);
    hydrationFailureRef.current = null;
    const result = await imagesQuery.refetch();
    if (!canvasApi || !result.data || imagePublicIds.length === 0) return;
    const returnedPublicIds = new Set(
      result.data.images.map((image) => image.publicId),
    );
    if (imagePublicIds.some((publicId) => !returnedPublicIds.has(publicId))) {
      setHydrationFailed(true);
      return;
    }
    try {
      await hydrateCardCanvasImages(canvasApi, result.data.images);
    } catch {
      setHydrationFailed(true);
    }
  }, [canvasApi, imagePublicIds, imagesQuery]);

  return {
    isBusy,
    imageLoadError:
      imagePublicIds.length > 0 && (imagesQuery.isError || hydrationFailed),
    isLoadingImages:
      imagePublicIds.length > 0 && imagesQuery.isLoading && !imagesQuery.data,
    pasteFromClipboard,
    importFiles,
    handlePasteCapture,
    handleDragOverCapture,
    handleDropCapture,
    handleExcalidrawPaste,
    deleteUnusedImages,
    refreshImages,
  };
}
