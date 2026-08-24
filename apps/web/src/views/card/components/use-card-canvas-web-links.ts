import type { ClipboardData } from "@excalidraw/excalidraw/clipboard";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { t } from "@lingui/core/macro";
import { useCallback, useState } from "react";

import type { WebCardResource } from "./card-resource-types";
import { usePopup } from "~/providers/popup";
import { insertCardCanvasResource } from "./card-canvas-resources";
import {
  getCardCanvasPastedWebLink,
  isWebLinkLimitError,
} from "./card-web-link";
import { useCreateCardWebLink } from "./use-card-web-link";

interface UseCardCanvasWebLinksInput {
  cardPublicId: string;
  canEdit: boolean;
  isPublicBoard: boolean;
  excalidrawApi: ExcalidrawImperativeAPI | null;
}

export function useCardCanvasWebLinks({
  cardPublicId,
  canEdit,
  isPublicBoard,
  excalidrawApi,
}: UseCardCanvasWebLinksInput) {
  const { showPopup } = usePopup();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [initialUrl, setInitialUrl] = useState("");
  const { createWebLink, isPending } = useCreateCardWebLink(cardPublicId);

  const insertCreatedWebLink = useCallback(
    async (resource: WebCardResource) => {
      if (!excalidrawApi) return;
      try {
        await insertCardCanvasResource(excalidrawApi, resource);
      } catch {
        showPopup({
          header: t`Link saved, but not placed`,
          message: t`The link is safe in Resources. Open the resource drawer to place it again.`,
          icon: "error",
        });
      }
    },
    [excalidrawApi, showPopup],
  );

  const openDialog = useCallback((url = "") => {
    setInitialUrl(url);
    setIsDialogOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    setIsDialogOpen(false);
    setInitialUrl("");
  }, []);

  const importWebLink = useCallback(
    async (url: string) => {
      if (!canEdit) return;
      if (isPublicBoard) {
        openDialog(url);
        return;
      }
      if (!navigator.onLine) {
        showPopup({
          header: t`Link not added while offline`,
          message: t`Links need secure card storage before they can appear on the whiteboard.`,
          icon: "error",
        });
        return;
      }
      try {
        const resource = await createWebLink(url);
        await insertCreatedWebLink(resource);
      } catch (error) {
        showPopup({
          header: t`Link could not be added`,
          message: isWebLinkLimitError(error)
            ? t`This card already has 100 web links.`
            : t`The whiteboard was not changed. Check the link and try again.`,
          icon: "error",
        });
      }
    },
    [
      canEdit,
      createWebLink,
      insertCreatedWebLink,
      isPublicBoard,
      openDialog,
      showPopup,
    ],
  );

  const handlePaste = useCallback(
    (data: ClipboardData) => {
      const pastedUrl = getCardCanvasPastedWebLink(
        data,
        Boolean(excalidrawApi?.getAppState().editingTextElement),
      );
      if (!pastedUrl || !canEdit) return null;
      void importWebLink(pastedUrl);
      return false;
    },
    [canEdit, excalidrawApi, importWebLink],
  );

  return {
    isDialogOpen,
    initialUrl,
    openDialog,
    closeDialog,
    insertCreatedWebLink,
    createWebLinkResource: createWebLink,
    handlePaste,
    isPending,
  };
}
