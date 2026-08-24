import type { ClipboardData } from "@excalidraw/excalidraw/clipboard";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type {
  ClipboardEvent as ReactClipboardEvent,
  DragEvent as ReactDragEvent,
} from "react";
import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useRef, useState } from "react";

import type { CardResource, UploadCardResource } from "./card-resource-types";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import { invalidateCard } from "~/utils/cardInvalidation";
import { validateAttachmentFile } from "./attachment-upload";
import {
  createCardCanvasImageImportQueue,
  downloadCardCanvasImageUrl,
  getCardCanvasImageFiles,
  getCardCanvasNativePasteAction,
  hasCardCanvasImageDragItem,
} from "./card-canvas-image-import";
import { preflightCardCanvasImageFile } from "./card-canvas-resources";
import { hashResourceFile, uploadResourceFile } from "./resource-upload-queue";

const MERMAID_PATTERN =
  /^\s*(graph\s|flowchart\s|sequenceDiagram\b|classDiagram\b|stateDiagram\b|erDiagram\b|gantt\b|pie\b|journey\b)/i;

interface UseCardCanvasImagePasteInput {
  cardPublicId: string;
  canEdit: boolean;
  isPublicBoard: boolean;
  excalidrawApi: ExcalidrawImperativeAPI | null;
  resources: CardResource[];
  onResourceCreated: (resource: CardResource) => Promise<void>;
}

export function useCardCanvasImagePaste({
  cardPublicId,
  canEdit,
  isPublicBoard,
  excalidrawApi,
  resources,
  onResourceCreated,
}: UseCardCanvasImagePasteInput) {
  const utils = api.useUtils();
  const { showPopup } = usePopup();
  const [pendingPublicImage, setPendingPublicImage] = useState<File | null>(
    null,
  );
  const [isUploadingPaste, setIsUploadingPaste] = useState(false);
  const [isImageImportBusy, setIsImageImportBusy] = useState(false);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const publicDecisionRef = useRef<((approved: boolean) => void) | null>(null);
  const importQueueRef = useRef(createCardCanvasImageImportQueue());
  const queuedImportsRef = useRef(0);
  const mountedRef = useRef(true);
  const resourcesRef = useRef(resources);
  resourcesRef.current = resources;
  const createUploadMutation = api.cardResource.createUpload.useMutation();
  const confirmUploadMutation = api.cardResource.confirmUpload.useMutation();
  const importRemoteImageMutation =
    api.cardResource.importRemoteImage.useMutation();

  const showImageRejected = useCallback(() => {
    showPopup({
      header: t`Image could not be added`,
      message: t`Choose a supported image within the whiteboard size and resolution limits.`,
      icon: "error",
    });
  }, [showPopup]);

  const requestPublicApproval = useCallback((file: File) => {
    return new Promise<boolean>((resolve) => {
      publicDecisionRef.current = resolve;
      setPendingPublicImage(file);
    });
  }, []);

  const uploadImageResource = useCallback(
    async (
      file: File,
      publicVisibilityAcknowledged?: boolean,
    ): Promise<UploadCardResource> => {
      if (!excalidrawApi || !canEdit || !mountedRef.current) {
        throw new Error("IMAGE_IMPORT_UNAVAILABLE");
      }
      const contentType = validateAttachmentFile(file);
      await preflightCardCanvasImageFile({
        file,
        contentType,
        api: excalidrawApi,
        resources: resourcesRef.current,
      });
      if (!navigator.onLine) throw new Error("IMAGE_IMPORT_OFFLINE");
      setIsUploadingPaste(true);
      try {
        const sha256 = await hashResourceFile(file);
        const session = await createUploadMutation.mutateAsync({
          cardPublicId,
          filename: file.name,
          contentType,
          size: file.size,
          sha256,
          publicVisibilityAcknowledged,
        });
        const abortController = new AbortController();
        uploadAbortRef.current = abortController;
        await uploadResourceFile(
          session.url,
          file,
          contentType,
          abortController.signal,
          () => undefined,
        );
        const resource = await confirmUploadMutation.mutateAsync({
          cardPublicId,
          uploadSessionPublicId: session.uploadSessionPublicId,
          publicVisibilityAcknowledged,
        });
        if (resource.kind !== "upload") {
          throw new Error("INVALID_UPLOAD_RESOURCE");
        }
        if (
          !resourcesRef.current.some(
            (current) => current.publicId === resource.publicId,
          )
        ) {
          resourcesRef.current = [...resourcesRef.current, resource];
        }
        await Promise.all([
          utils.cardResource.list.invalidate({ cardPublicId }),
          invalidateCard(utils, cardPublicId),
          utils.board.byId.invalidate(),
        ]);
        return resource;
      } finally {
        uploadAbortRef.current = null;
        setIsUploadingPaste(false);
      }
    },
    [
      canEdit,
      cardPublicId,
      confirmUploadMutation,
      createUploadMutation,
      excalidrawApi,
      utils,
    ],
  );

  const processImage = useCallback(
    async (file: File) => {
      if (!excalidrawApi || !canEdit || !mountedRef.current) return;
      try {
        const contentType = validateAttachmentFile(file);
        await preflightCardCanvasImageFile({
          file,
          contentType,
          api: excalidrawApi,
          resources: resourcesRef.current,
        });
      } catch {
        showImageRejected();
        return;
      }
      if (!navigator.onLine) {
        showPopup({
          header: t`Image not added while offline`,
          message: t`Text and shapes remain available offline. Images need secure card storage first.`,
          icon: "error",
        });
        return;
      }

      const publicVisibilityAcknowledged = isPublicBoard
        ? await requestPublicApproval(file)
        : undefined;
      if (publicVisibilityAcknowledged === false) return;
      try {
        const resource = await uploadImageResource(
          file,
          publicVisibilityAcknowledged,
        );
        await onResourceCreated(resource);
      } catch {
        showPopup({
          header: t`Image could not be added`,
          message: t`The whiteboard was not changed. Try again or upload the image from Files.`,
          icon: "error",
        });
      } finally {
        publicDecisionRef.current = null;
        setPendingPublicImage(null);
      }
    },
    [
      canEdit,
      excalidrawApi,
      isPublicBoard,
      onResourceCreated,
      requestPublicApproval,
      showImageRejected,
      showPopup,
      uploadImageResource,
    ],
  );

  const importRemoteImageResource = useCallback(
    async (
      url: string,
      publicVisibilityAcknowledged?: boolean,
    ): Promise<UploadCardResource> => {
      if (!excalidrawApi || !canEdit || !mountedRef.current) {
        throw new Error("IMAGE_IMPORT_UNAVAILABLE");
      }
      if (!navigator.onLine) throw new Error("IMAGE_IMPORT_OFFLINE");
      setIsUploadingPaste(true);
      try {
        const resource = await importRemoteImageMutation.mutateAsync({
          cardPublicId,
          url,
          publicVisibilityAcknowledged,
        });
        if (
          !resourcesRef.current.some(
            (current) => current.publicId === resource.publicId,
          )
        ) {
          resourcesRef.current = [...resourcesRef.current, resource];
        }
        await Promise.all([
          utils.cardResource.list.invalidate({ cardPublicId }),
          invalidateCard(utils, cardPublicId),
          utils.board.byId.invalidate(),
        ]);
        return resource;
      } finally {
        setIsUploadingPaste(false);
      }
    },
    [canEdit, cardPublicId, excalidrawApi, importRemoteImageMutation, utils],
  );

  const enqueueImageImport = useCallback(
    (loadFile: () => Promise<File>, source: "local" | "remote" = "local") => {
      if (!canEdit) return;
      queuedImportsRef.current += 1;
      setIsImageImportBusy(true);
      void importQueueRef
        .current(async () => {
          try {
            await processImage(await loadFile());
          } catch {
            if (source === "remote") {
              showPopup({
                header: t`Online image could not be imported`,
                message: t`The image host did not allow a safe browser download. Save it and upload it from Files.`,
                icon: "error",
              });
            } else {
              showImageRejected();
            }
          }
        })
        .finally(() => {
          queuedImportsRef.current -= 1;
          if (mountedRef.current && queuedImportsRef.current === 0) {
            setIsImageImportBusy(false);
          }
        });
    },
    [canEdit, processImage, showImageRejected, showPopup],
  );

  const importFiles = useCallback(
    (files: File[]) => {
      files.forEach((file) => enqueueImageImport(() => Promise.resolve(file)));
    },
    [enqueueImageImport],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      publicDecisionRef.current?.(false);
      uploadAbortRef.current?.abort();
    };
  }, []);

  const handlePasteCapture = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>) => {
      if (!canEdit) return;
      const images = getCardCanvasImageFiles(event.clipboardData.files);
      if (images.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      importFiles(images);
    },
    [canEdit, importFiles],
  );

  const handleDragOverCapture = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      if (!canEdit) return;
      if (!hasCardCanvasImageDragItem(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    [canEdit],
  );

  const handleDropCapture = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      if (!canEdit) return;
      const images = getCardCanvasImageFiles(event.dataTransfer.files);
      if (images.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      importFiles(images);
    },
    [canEdit, importFiles],
  );

  const handleExcalidrawPaste = useCallback(
    (data: ClipboardData) => {
      const elementPasteAction = getCardCanvasNativePasteAction({
        currentElementCount: excalidrawApi?.getSceneElements().length ?? 0,
        elements: data.elements,
        files: data.files,
      });
      if (elementPasteAction === "block") {
        showPopup({
          header: t`This paste exceeds the whiteboard limits`,
          message: t`Remove some elements or images before pasting this content. No resources were imported.`,
          icon: "error",
        });
        return false;
      }
      if (elementPasteAction === "image") {
        showPopup({
          header: t`Paste the source image instead`,
          message: t`Images copied from another scene must be uploaded as card resources first.`,
          icon: "error",
        });
        return false;
      }
      const imageUrl = data.mixedContent?.find(
        (item) => item.type === "imageUrl",
      )?.value;
      if (imageUrl) {
        enqueueImageImport(
          () => downloadCardCanvasImageUrl(imageUrl),
          "remote",
        );
        return false;
      }
      if (data.text && MERMAID_PATTERN.test(data.text)) {
        showPopup({
          header: t`Mermaid is not available here`,
          message: t`Use the native shapes, text and arrows on this whiteboard.`,
          icon: "error",
        });
        return false;
      }
      return true;
    },
    [enqueueImageImport, excalidrawApi, showPopup],
  );

  return {
    pendingPublicImage,
    isUploadingPaste,
    isImageImportBusy,
    handlePasteCapture,
    handleDragOverCapture,
    handleDropCapture,
    handleExcalidrawPaste,
    uploadImageResource,
    importRemoteImageResource,
    importImageFile: (file: File) => importFiles([file]),
    confirmPublicImage: () => publicDecisionRef.current?.(true),
    cancelPublicImage: () => {
      setPendingPublicImage(null);
      publicDecisionRef.current?.(false);
      publicDecisionRef.current = null;
    },
  };
}
