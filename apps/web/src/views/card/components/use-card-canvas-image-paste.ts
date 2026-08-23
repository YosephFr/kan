import type { ClipboardData } from "@excalidraw/excalidraw/clipboard";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ClipboardEvent as ReactClipboardEvent } from "react";
import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useRef, useState } from "react";

import type { CardResource } from "./card-resource-types";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import { invalidateCard } from "~/utils/cardInvalidation";
import { validateAttachmentFile } from "./attachment-upload";
import {
  hashResourceFile,
  isVisibilityAcknowledgementError,
  uploadResourceFile,
} from "./resource-upload-queue";

const MERMAID_PATTERN =
  /^\s*(graph\s|flowchart\s|sequenceDiagram\b|classDiagram\b|stateDiagram\b|erDiagram\b|gantt\b|pie\b|journey\b)/i;

const externalImageToFile = async (value: string) => {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("UNSAFE_IMAGE_URL");
  const response = await fetch(url.toString(), {
    mode: "cors",
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) throw new Error("IMAGE_DOWNLOAD_FAILED");
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("NOT_AN_IMAGE");
  const extension = blob.type.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
  return new File([blob], `imagen-pizarra.${extension}`, { type: blob.type });
};

interface UseCardCanvasImagePasteInput {
  cardPublicId: string;
  canEdit: boolean;
  isPublicBoard: boolean;
  excalidrawApi: ExcalidrawImperativeAPI | null;
  onResourceCreated: (resource: CardResource) => Promise<void>;
}

export function useCardCanvasImagePaste({
  cardPublicId,
  canEdit,
  isPublicBoard,
  excalidrawApi,
  onResourceCreated,
}: UseCardCanvasImagePasteInput) {
  const utils = api.useUtils();
  const { showPopup } = usePopup();
  const [pendingPublicImage, setPendingPublicImage] = useState<File | null>(
    null,
  );
  const [isUploadingPaste, setIsUploadingPaste] = useState(false);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const createUploadMutation = api.cardResource.createUpload.useMutation();
  const confirmUploadMutation = api.cardResource.confirmUpload.useMutation();

  const uploadPastedImage = useCallback(
    async (file: File, publicVisibilityAcknowledged?: boolean) => {
      if (!excalidrawApi || !canEdit) return;
      if (!navigator.onLine) {
        showPopup({
          header: t`Image not added while offline`,
          message: t`Text and shapes remain available offline. Images need secure card storage first.`,
          icon: "error",
        });
        return;
      }
      setIsUploadingPaste(true);
      try {
        const contentType = validateAttachmentFile(file);
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
        await Promise.all([
          utils.cardResource.list.invalidate({ cardPublicId }),
          invalidateCard(utils, cardPublicId),
          utils.board.byId.invalidate(),
        ]);
        await onResourceCreated(resource);
        setPendingPublicImage(null);
      } catch (error) {
        if (isVisibilityAcknowledgementError(error)) {
          setPendingPublicImage(file);
        } else {
          showPopup({
            header: t`Image could not be added`,
            message: t`The whiteboard was not changed. Try again or upload the image from Files.`,
            icon: "error",
          });
        }
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
      onResourceCreated,
      showPopup,
      utils,
    ],
  );

  useEffect(
    () => () => {
      uploadAbortRef.current?.abort();
    },
    [],
  );

  const handleIncomingImage = useCallback(
    (file: File) => {
      if (isPublicBoard) setPendingPublicImage(file);
      else void uploadPastedImage(file);
    },
    [isPublicBoard, uploadPastedImage],
  );

  const handlePasteCapture = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>) => {
      if (!canEdit) return;
      const image = Array.from(event.clipboardData.files).find((file) =>
        file.type.startsWith("image/"),
      );
      if (!image) return;
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      handleIncomingImage(image);
    },
    [canEdit, handleIncomingImage],
  );

  const handleExcalidrawPaste = useCallback(
    (data: ClipboardData) => {
      if (
        (data.files && Object.keys(data.files).length > 0) ||
        data.elements?.some((element) => element.type === "image")
      ) {
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
        void externalImageToFile(imageUrl)
          .then(handleIncomingImage)
          .catch(() =>
            showPopup({
              header: t`Online image could not be imported`,
              message: t`The image host did not allow a safe browser download. Save it and upload it from Files.`,
              icon: "error",
            }),
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
    [handleIncomingImage, showPopup],
  );

  return {
    pendingPublicImage,
    isUploadingPaste,
    handlePasteCapture,
    handleExcalidrawPaste,
    confirmPublicImage: () => {
      if (pendingPublicImage) void uploadPastedImage(pendingPublicImage, true);
    },
    cancelPublicImage: () => setPendingPublicImage(null),
  };
}
