import type { ClipboardData } from "@excalidraw/excalidraw/clipboard";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type {
  ClipboardEvent as ReactClipboardEvent,
  DragEvent as ReactDragEvent,
} from "react";
import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useRef, useState } from "react";

import { MAX_CARD_CANVAS_ELEMENTS } from "@kan/shared";

import type { WorkspaceCanvasImageCleanupTarget } from "./workspace-canvas-image-cleanup";
import type { WorkspaceCanvasImageResource } from "./workspace-canvas-image-loader";
import type { WorkspaceCanvasPasteBatchItem } from "./workspace-canvas-paste-batch";
import type { CardCanvasClipboardResult } from "~/views/card/components/card-canvas-clipboard";
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
  hashResourceFile,
  uploadResourceFile,
} from "~/views/card/components/resource-upload-queue";
import {
  discardWorkspaceCanvasImage,
  drainWorkspaceCanvasImageCleanup,
  getWorkspaceCanvasImageCleanupKey,
} from "./workspace-canvas-image-cleanup";
import {
  addWorkspaceCanvasImageBlob,
  hydrateWorkspaceCanvasImage,
  runWorkspaceCanvasImageQueue,
} from "./workspace-canvas-image-loader";
import { prepareWorkspaceCanvasLocalImage } from "./workspace-canvas-local-image";
import {
  makeWorkspaceCanvasFilePasteItems,
  toWorkspaceCanvasPasteText,
} from "./workspace-canvas-paste";
import { insertWorkspaceCanvasPasteBatch } from "./workspace-canvas-paste-batch";
import { constrainWorkspaceCanvasSelection } from "./workspace-canvas-vertical-track";

interface PendingWorkspaceCanvasUpload {
  workspacePublicId: string;
  prepared: Awaited<ReturnType<typeof prepareWorkspaceCanvasLocalImage>>;
  sha256: string;
  session?: {
    url: string;
    uploadSessionPublicId: string;
    expiresAt: Date;
  };
  uploadComplete: boolean;
}

const isErrorCode = (error: unknown, code: string) =>
  error instanceof Error &&
  (error.message.includes(code) || error.name.includes(code));

const shouldForgetPendingUpload = (error: unknown) =>
  [
    "WORKSPACE_CANVAS_IMAGE_INVALID",
    "WORKSPACE_CANVAS_IMAGE_DIMENSIONS_INVALID",
    "WORKSPACE_CANVAS_IMAGE_OPTIMIZATION_FAILED",
  ].some((code) => isErrorCode(error, code));

const assertNotAborted = (signal: AbortSignal) => {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
};

const getClipboardImageOnlyFiles = async (items: readonly ClipboardItem[]) => {
  if (
    items.length === 0 ||
    items.some((item) =>
      item.types.some((type) =>
        ["text/html", "text/plain", "text/uri-list"].includes(type),
      ),
    )
  ) {
    return null;
  }
  const files: File[] = [];
  for (const [index, item] of items.entries()) {
    const contentType = item.types.find((type) => type.startsWith("image/"));
    if (!contentType) return null;
    const blob = await item.getType(contentType);
    const extension =
      contentType === "image/jpeg"
        ? "jpg"
        : contentType === "image/png"
          ? "png"
          : "webp";
    files.push(
      new File([blob], `pizarra-${index + 1}.${extension}`, {
        type: contentType,
      }),
    );
  }
  return files;
};

export function useWorkspaceCanvasPaste({
  workspacePublicId,
  knownUsageBytes,
  quotaBytes,
  canvasApi,
  canEdit,
  onImagesChanged,
}: {
  workspacePublicId: string;
  knownUsageBytes: number;
  quotaBytes: number;
  canvasApi: ExcalidrawImperativeAPI | null;
  canEdit: boolean;
  onImagesChanged: () => void;
}) {
  const { showPopup } = usePopup();
  const utils = api.useUtils();
  const [isBusy, setIsBusy] = useState(false);
  const [failedImageItems, setFailedImageItems] = useState<
    CardCanvasClipboardResult["items"]
  >([]);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const workspaceRef = useRef(workspacePublicId);
  const abortControllersRef = useRef(new Set<AbortController>());
  const pendingUploadsRef = useRef(
    new WeakMap<File, PendingWorkspaceCanvasUpload>(),
  );
  const cleanupPendingRef = useRef(
    new Map<string, WorkspaceCanvasImageCleanupTarget>(),
  );
  const createUpload = api.workspaceCanvas.createImageUpload.useMutation();
  const confirmUpload = api.workspaceCanvas.confirmImageUpload.useMutation();
  const importRemoteImage = api.workspaceCanvas.importRemoteImage.useMutation();
  const deleteImage = api.workspaceCanvas.deleteImage.useMutation();

  const drainPendingImages = useCallback(
    async (targetWorkspacePublicId: string) => {
      const targets = [...cleanupPendingRef.current.values()].filter(
        (target) => target.workspacePublicId === targetWorkspacePublicId,
      );
      const failed = await drainWorkspaceCanvasImageCleanup({
        targets,
        remove: (target) =>
          deleteImage.mutateAsync({
            workspacePublicId: target.workspacePublicId,
            imagePublicId: target.imagePublicId,
          }),
      });
      const failedKeys = new Set(failed.map(getWorkspaceCanvasImageCleanupKey));
      for (const target of targets) {
        const key = getWorkspaceCanvasImageCleanupKey(target);
        if (!failedKeys.has(key)) cleanupPendingRef.current.delete(key);
      }
      return failed;
    },
    [deleteImage],
  );

  const discardCreatedImage = useCallback(
    async (target: WorkspaceCanvasImageCleanupTarget) => {
      const key = getWorkspaceCanvasImageCleanupKey(target);
      cleanupPendingRef.current.set(key, target);
      const removed = await discardWorkspaceCanvasImage({
        target,
        remove: (candidate) =>
          deleteImage.mutateAsync({
            workspacePublicId: candidate.workspacePublicId,
            imagePublicId: candidate.imagePublicId,
          }),
      });
      if (removed) cleanupPendingRef.current.delete(key);
      return removed;
    },
    [deleteImage],
  );

  useEffect(() => {
    const abortControllers = abortControllersRef.current;
    mountedRef.current = true;
    workspaceRef.current = workspacePublicId;
    setFailedImageItems([]);
    return () => {
      mountedRef.current = false;
      for (const controller of abortControllers) controller.abort();
      abortControllers.clear();
    };
  }, [workspacePublicId]);

  const showBusyPopup = useCallback(
    () =>
      showPopup({
        header: t`Paste is still in progress`,
        message: t`Wait for the current images to finish before adding more content.`,
        icon: "error",
      }),
    [showPopup],
  );

  const showQuotaPopup = useCallback(
    (partial: boolean, usage = knownUsageBytes, quota = quotaBytes) => {
      const usedMiB = (usage / 1024 / 1024).toFixed(1);
      const quotaMiB = Math.round(quota / 1024 / 1024);
      showPopup({
        header: partial
          ? t`Some images were skipped`
          : t`Image storage is full`,
        message: t`This whiteboard is using ${usedMiB} MiB of its ${quotaMiB} MiB image storage. Remove images before adding more.`,
        icon: partial ? "success" : "error",
      });
    },
    [knownUsageBytes, quotaBytes, showPopup],
  );

  const showPhysicalStoragePopup = useCallback(
    (partial: boolean) =>
      showPopup({
        header: partial
          ? t`Some images were skipped`
          : t`Image storage is full`,
        message: t`Remove some elements before pasting more content.`,
        icon: partial ? "success" : "error",
      }),
    [showPopup],
  );

  const uploadFile = useCallback(
    async (
      file: File,
      onCreated: (resource: WorkspaceCanvasImageResource) => void,
    ) => {
      if (!canvasApi || !canEdit || !navigator.onLine) {
        throw new Error("WORKSPACE_CANVAS_IMAGE_UNAVAILABLE");
      }
      const abortController = new AbortController();
      abortControllersRef.current.add(abortController);
      try {
        let pending = pendingUploadsRef.current.get(file);
        if (!pending || pending.workspacePublicId !== workspacePublicId) {
          const [prepared, sha256] = await Promise.all([
            prepareWorkspaceCanvasLocalImage(file, abortController.signal),
            hashResourceFile(file),
          ]);
          pending = {
            workspacePublicId,
            prepared,
            sha256,
            uploadComplete: false,
          };
          pendingUploadsRef.current.set(file, pending);
        }
        assertNotAborted(abortController.signal);
        if (
          pending.session &&
          pending.session.expiresAt.getTime() <= Date.now()
        ) {
          pending.session = undefined;
          pending.uploadComplete = false;
        }
        pending.session ??= await createUpload.mutateAsync({
          workspacePublicId,
          filename: file.name,
          contentType: pending.prepared.contentType,
          size: file.size,
          sha256: pending.sha256,
        });
        assertNotAborted(abortController.signal);
        if (!pending.uploadComplete) {
          await uploadResourceFile(
            pending.session.url,
            file,
            pending.prepared.contentType,
            abortController.signal,
            () => undefined,
          );
          pending.uploadComplete = true;
        }
        let resource: WorkspaceCanvasImageResource;
        try {
          resource = (await confirmUpload.mutateAsync({
            workspacePublicId,
            uploadSessionPublicId: pending.session.uploadSessionPublicId,
          })) as WorkspaceCanvasImageResource;
        } catch (error) {
          if (shouldForgetPendingUpload(error)) {
            pendingUploadsRef.current.delete(file);
          }
          throw error;
        }
        pendingUploadsRef.current.delete(file);
        onCreated(resource);
        try {
          await addWorkspaceCanvasImageBlob({
            api: canvasApi,
            resource,
            blob: pending.prepared.displayBlob,
            signal: abortController.signal,
          });
        } catch (error) {
          await discardCreatedImage({
            workspacePublicId,
            imagePublicId: resource.publicId,
          });
          throw error;
        }
        return {
          resource,
          dimensions: pending.prepared.displayDimensions,
        };
      } finally {
        abortControllersRef.current.delete(abortController);
      }
    },
    [
      canEdit,
      canvasApi,
      confirmUpload,
      createUpload,
      discardCreatedImage,
      workspacePublicId,
    ],
  );

  const processItems = useCallback(
    async ({
      items,
      imagesOmitted,
    }: Pick<CardCanvasClipboardResult, "items" | "imagesOmitted">) => {
      if (!canvasApi || !canEdit) return;
      const online = navigator.onLine;
      const processableItems = online
        ? items
        : items.filter((item) => item.type !== "image");
      const hasImages = processableItems.some((item) => item.type === "image");
      if (
        hasImages &&
        (await drainPendingImages(workspacePublicId)).length > 0
      ) {
        throw new Error("WORKSPACE_CANVAS_IMAGE_CLEANUP_PENDING");
      }
      if (
        canvasApi.getSceneElements().length + processableItems.length >
        MAX_CARD_CANVAS_ELEMENTS
      ) {
        throw new Error("CARD_CANVAS_ELEMENT_LIMIT_EXCEEDED");
      }
      const operationWorkspacePublicId = workspacePublicId;
      const shouldContinue = () =>
        mountedRef.current &&
        workspaceRef.current === operationWorkspacePublicId;
      setFailedImageItems([]);
      const offlineImageCount = online
        ? 0
        : items.filter((item) => item.type === "image").length;
      const pasteItems: (WorkspaceCanvasPasteBatchItem | undefined)[] =
        Array.from({ length: processableItems.length });
      const imageTasks = processableItems.flatMap((item, index) =>
        item.type === "image" ? [{ item, index }] : [],
      );
      processableItems.forEach((item, index) => {
        if (item.type === "text" || item.type === "link") {
          pasteItems[index] = {
            kind: "text",
            text: toWorkspaceCanvasPasteText(item),
          };
        }
      });

      const createdImages = new Map<string, WorkspaceCanvasImageResource>();
      const rememberCreatedImage = (resource: WorkspaceCanvasImageResource) => {
        createdImages.set(resource.publicId, resource);
      };
      const failures: unknown[] = [];
      const failedItems: CardCanvasClipboardResult["items"] = [];
      await runWorkspaceCanvasImageQueue({
        items: imageTasks,
        worker: async ({ item, index }) => {
          if (!shouldContinue()) {
            throw new Error("WORKSPACE_CANVAS_PASTE_CANCELLED");
          }
          if (item.source === "file") {
            const uploaded = await uploadFile(item.file, rememberCreatedImage);
            pasteItems[index] = {
              kind: "resource",
              resource: uploaded.resource,
              dimensions: uploaded.dimensions,
            };
            return;
          }
          const resource = (await importRemoteImage.mutateAsync({
            workspacePublicId,
            url: item.url,
          })) as WorkspaceCanvasImageResource;
          rememberCreatedImage(resource);
          if (!shouldContinue()) {
            await discardCreatedImage({
              workspacePublicId,
              imagePublicId: resource.publicId,
            });
            throw new Error("WORKSPACE_CANVAS_PASTE_CANCELLED");
          }
          const abortController = new AbortController();
          abortControllersRef.current.add(abortController);
          let dimensions: { width: number; height: number };
          try {
            dimensions = await hydrateWorkspaceCanvasImage({
              api: canvasApi,
              resource,
              signal: abortController.signal,
            });
          } catch (error) {
            await discardCreatedImage({
              workspacePublicId,
              imagePublicId: resource.publicId,
            });
            throw error;
          } finally {
            abortControllersRef.current.delete(abortController);
          }
          pasteItems[index] = { kind: "resource", resource, dimensions };
        },
        onSettled: (task, error) => {
          if (error) {
            failures.push(error);
            failedItems.push(task.item);
          }
        },
      });
      const offlineItems = online
        ? []
        : items.filter((item) => item.type === "image");
      if (shouldContinue()) {
        setFailedImageItems([...offlineItems, ...failedItems]);
      }

      const cleanup = async () => {
        await Promise.all(
          [...createdImages.values()].map((image) =>
            discardCreatedImage({
              workspacePublicId: operationWorkspacePublicId,
              imagePublicId: image.publicId,
            }),
          ),
        );
      };
      if (!shouldContinue()) {
        await cleanup();
        return;
      }
      const resolvedItems = pasteItems.filter(
        (item): item is WorkspaceCanvasPasteBatchItem => Boolean(item),
      );
      try {
        if (resolvedItems.length > 0) {
          insertWorkspaceCanvasPasteBatch({
            api: canvasApi,
            items: resolvedItems,
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
        await cleanup();
        throw error;
      }
      if (createdImages.size > 0) {
        await utils.workspaceCanvas.listImages.invalidate();
        onImagesChanged();
      }

      const skippedImages =
        (imagesOmitted ? 1 : 0) + offlineImageCount + failures.length;
      if (skippedImages === 0) return;
      if (
        failures.some((error) =>
          isErrorCode(error, "WORKSPACE_CANVAS_IMAGE_STORAGE_LIMIT_REACHED"),
        )
      ) {
        showPhysicalStoragePopup(resolvedItems.length > 0);
        return;
      }
      if (
        failures.some((error) =>
          isErrorCode(error, "WORKSPACE_CANVAS_IMAGE_TOTAL_LIMIT_REACHED"),
        ) ||
        knownUsageBytes >= quotaBytes
      ) {
        try {
          const storage = await utils.workspaceCanvas.listImages.fetch({
            workspacePublicId,
            imagePublicIds: [],
          });
          showQuotaPopup(
            resolvedItems.length > 0,
            storage.usageBytes,
            storage.quotaBytes,
          );
        } catch {
          showQuotaPopup(resolvedItems.length > 0);
        }
        return;
      }
      showPopup({
        header:
          resolvedItems.length > 0
            ? t`Some images were skipped`
            : t`Images could not be added`,
        message: navigator.onLine
          ? t`Use JPEG, PNG or WebP images up to 10 MiB each.`
          : t`Text was kept editable. Images need a connection so they can be stored securely.`,
        icon: resolvedItems.length > 0 ? "success" : "error",
      });
    },
    [
      canEdit,
      canvasApi,
      discardCreatedImage,
      drainPendingImages,
      importRemoteImage,
      knownUsageBytes,
      quotaBytes,
      onImagesChanged,
      showPopup,
      showPhysicalStoragePopup,
      showQuotaPopup,
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
        .catch((error: unknown) => {
          if (!mountedRef.current) return;
          if (
            isErrorCode(error, "WORKSPACE_CANVAS_IMAGE_STORAGE_LIMIT_REACHED")
          ) {
            showPhysicalStoragePopup(false);
            return;
          }
          if (
            isErrorCode(error, "WORKSPACE_CANVAS_IMAGE_TOTAL_LIMIT_REACHED")
          ) {
            showQuotaPopup(false);
            return;
          }
          if (isErrorCode(error, "CARD_CANVAS_ELEMENT_LIMIT_EXCEEDED")) {
            showPopup({
              header: t`This paste exceeds the whiteboard limits`,
              message: t`Remove some elements before pasting more content.`,
              icon: "error",
            });
            return;
          }
          if (isErrorCode(error, "WORKSPACE_CANVAS_IMAGE_CLEANUP_PENDING")) {
            showPopup({
              header: t`Images could not be added`,
              message: t`Some unused local images could not be cleaned up. Your whiteboard content is safe.`,
              icon: "error",
            });
            return;
          }
          const permissionDenied =
            error instanceof DOMException &&
            ["NotAllowedError", "SecurityError"].includes(error.name);
          showPopup({
            header: permissionDenied
              ? t`Clipboard permission was not granted`
              : t`Clipboard content could not be pasted`,
            message: permissionDenied
              ? t`Use the browser Paste action or Cmd+V inside the whiteboard.`
              : t`The whiteboard was not changed. Try again or add the images from your device.`,
            icon: "error",
          });
        })
        .finally(() => {
          busyRef.current = false;
          if (mountedRef.current) setIsBusy(false);
        });
    },
    [showBusyPopup, showPhysicalStoragePopup, showPopup, showQuotaPopup],
  );

  const importFiles = useCallback(
    (files: File[]) => {
      if (!canEdit || files.length === 0) return;
      run(() =>
        processItems({ items: makeWorkspaceCanvasFilePasteItems(files) }),
      );
    },
    [canEdit, processItems, run],
  );

  const retryFailedImages = useCallback(() => {
    if (!canEdit || failedImageItems.length === 0) return;
    const items = failedImageItems;
    run(() => processItems({ items }));
  }, [canEdit, failedImageItems, processItems, run]);

  const pasteFromClipboard = useCallback(() => {
    if (!canEdit) return;
    run(async () => {
      const clipboard = navigator.clipboard as {
        read?: Clipboard["read"];
        readText: Clipboard["readText"];
      };
      const includeImages = navigator.onLine;
      if (clipboard.read) {
        const clipboardItems = await clipboard.read();
        const imageFiles = includeImages
          ? await getClipboardImageOnlyFiles(clipboardItems)
          : null;
        if (imageFiles) {
          await processItems({
            items: makeWorkspaceCanvasFilePasteItems(imageFiles),
          });
          return;
        }
        const input = await readCardCanvasClipboardItems(clipboardItems, {
          includeImages,
        });
        const normalized = normalizeCardCanvasClipboard(input, {
          includeImages,
        });
        if (normalized.items.length === 0) throw new Error("EMPTY_CLIPBOARD");
        await processItems(normalized);
        return;
      }
      const normalized = normalizeCardCanvasClipboard({
        text: await clipboard.readText(),
      });
      if (normalized.items.length === 0) throw new Error("EMPTY_CLIPBOARD");
      await processItems(normalized);
    });
  }, [canEdit, processItems, run]);

  const handlePasteCapture = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>) => {
      if (!canEdit || canvasApi?.getAppState().editingTextElement) return;
      const directFiles = getCardCanvasImageFiles(event.clipboardData.files);
      const hasText = Array.from(event.clipboardData.types).some((type) =>
        ["text/html", "text/plain", "text/uri-list"].includes(type),
      );
      if (directFiles.length > 0 && !hasText) {
        consumeCardCanvasExternalPaste(event);
        importFiles(directFiles);
        return;
      }
      try {
        const includeImages = navigator.onLine;
        const input = getCardCanvasClipboardInputFromDataTransfer(
          event.clipboardData,
          { includeImages },
        );
        if (isCardCanvasInternalClipboard(input)) return;
        consumeCardCanvasExternalPaste(event);
        run(() =>
          processItems(normalizeCardCanvasClipboard(input, { includeImages })),
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
    [canEdit, canvasApi, importFiles, processItems, run, showPopup],
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
      const targets = publicIds.map((imagePublicId) => ({
        workspacePublicId,
        imagePublicId,
      }));
      const failed = await drainWorkspaceCanvasImageCleanup({
        targets,
        remove: (target) =>
          deleteImage.mutateAsync({
            workspacePublicId: target.workspacePublicId,
            imagePublicId: target.imagePublicId,
          }),
      });
      await utils.workspaceCanvas.listImages.invalidate();
      onImagesChanged();
      if (failed.length > 0) {
        for (const target of failed) {
          cleanupPendingRef.current.set(
            getWorkspaceCanvasImageCleanupKey(target),
            target,
          );
        }
        throw new Error("WORKSPACE_CANVAS_IMAGE_CLEANUP_PENDING");
      }
    },
    [
      deleteImage,
      onImagesChanged,
      utils.workspaceCanvas.listImages,
      workspacePublicId,
    ],
  );

  return {
    isBusy,
    failedImageCount: failedImageItems.length,
    retryFailedImages,
    pasteFromClipboard,
    importFiles,
    handlePasteCapture,
    handleDragOverCapture,
    handleDropCapture,
    handleExcalidrawPaste,
    deleteUnusedImages,
  };
}
