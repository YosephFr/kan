import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type {
  ClipboardEvent as ReactClipboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  CardCanvasClipboardItem,
  CardCanvasClipboardResult,
} from "./card-canvas-clipboard";
import type { CardCanvasResolvedPasteItem } from "./card-canvas-clipboard-resolve";
import type { CardResource, WebCardResource } from "./card-resource-types";
import { usePopup } from "~/providers/popup";
import {
  CardCanvasClipboardLimitError,
  isCardCanvasInternalClipboard,
  normalizeCardCanvasClipboard,
  readCardCanvasClipboardItems,
} from "./card-canvas-clipboard";
import {
  captureCardCanvasClipboardInput,
  CardCanvasClipboardOperationGate,
  consumeCardCanvasExternalPaste,
  getCardCanvasClipboardCaptureAction,
  isCardCanvasPasteAnchorTarget,
  resolveCardCanvasPublicPasteDecision,
} from "./card-canvas-clipboard-operation";
import { resolveCardCanvasClipboardItems } from "./card-canvas-clipboard-resolve";
import {
  assertCardCanvasPasteBatchBudget,
  assertCardCanvasPasteInputBudget,
} from "./card-canvas-paste-batch";

export interface CardCanvasPasteAnchor {
  x: number;
  y: number;
}

interface PendingCardCanvasPaste {
  result: CardCanvasClipboardResult;
  anchor: CardCanvasPasteAnchor | null;
}

interface UseCardCanvasClipboardInput {
  api: ExcalidrawImperativeAPI | null;
  canEdit: boolean;
  isPublicBoard: boolean;
  resourceImportBusy: boolean;
  resources: readonly CardResource[];
  uploadImageResource: (
    file: File,
    publicVisibilityAcknowledged?: boolean,
  ) => Promise<CardResource>;
  importRemoteImageResource: (
    url: string,
    publicVisibilityAcknowledged?: boolean,
  ) => Promise<CardResource>;
  createWebLinkResource: (
    url: string,
    publicVisibilityAcknowledged?: boolean,
  ) => Promise<WebCardResource>;
  insertBatch: (
    items: CardCanvasResolvedPasteItem[],
    anchor: CardCanvasPasteAnchor | null,
  ) => Promise<void>;
}

const countResourceItems = (result: CardCanvasClipboardResult) =>
  result.items.filter((item) => item.type !== "text").length;

export function useCardCanvasClipboard({
  api,
  canEdit,
  isPublicBoard,
  resourceImportBusy,
  resources,
  uploadImageResource,
  importRemoteImageResource,
  createWebLinkResource,
  insertBatch,
}: UseCardCanvasClipboardInput) {
  const { showPopup } = usePopup();
  const [pendingPublicPaste, setPendingPublicPaste] =
    useState<PendingCardCanvasPaste | null>(null);
  const [isReadingClipboard, setIsReadingClipboard] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const clipboardOperationGateRef = useRef(
    new CardCanvasClipboardOperationGate(),
  );
  const importInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const lastAnchorRef = useRef<CardCanvasPasteAnchor | null>(null);
  const isBusy = isReadingClipboard || isImporting || resourceImportBusy;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const showClipboardRejected = useCallback(() => {
    showPopup({
      header: t`Clipboard content could not be pasted`,
      message: t`Paste up to 20 items, including at most 10 images and 10 links, within the clipboard size limit.`,
      icon: "error",
    });
  }, [showPopup]);

  const resolveResource = useCallback(
    (
      item: Exclude<CardCanvasClipboardItem, { type: "text" }>,
      publicVisibilityAcknowledged?: boolean,
    ) => {
      if (item.type === "link") {
        return createWebLinkResource(item.url, publicVisibilityAcknowledged);
      }
      if (item.source === "file") {
        return uploadImageResource(item.file, publicVisibilityAcknowledged);
      }
      return importRemoteImageResource(item.url, publicVisibilityAcknowledged);
    },
    [createWebLinkResource, importRemoteImageResource, uploadImageResource],
  );

  const applyPaste = useCallback(
    async (
      pending: PendingCardCanvasPaste,
      publicVisibilityAcknowledged?: boolean,
    ) => {
      if (!api || !canEdit || resourceImportBusy || importInFlightRef.current) {
        return;
      }
      importInFlightRef.current = true;
      setIsImporting(true);
      try {
        const result = await resolveCardCanvasClipboardItems({
          items: pending.result.items,
          online: navigator.onLine,
          publicVisibilityAcknowledged,
          resolveResource,
          shouldContinue: () => mountedRef.current,
          validateResolvedItems: (items) =>
            assertCardCanvasPasteBatchBudget({
              elements: api.getSceneElements(),
              items,
              resources,
            }),
        });
        if (result.cancelled) return;
        if (result.items.length > 0) {
          await insertBatch(result.items, pending.anchor);
        }
        if (result.skipped > 0) {
          showPopup({
            header:
              result.items.length > 0
                ? t`Some pasted items were skipped`
                : t`Clipboard content could not be pasted`,
            message: navigator.onLine
              ? t`${result.skipped} images or links could not be imported safely. Save private images and upload them manually from Files.`
              : t`${result.skipped} images or links need a connection. Text was kept on the whiteboard.`,
            icon: result.items.length > 0 ? "success" : "error",
          });
        }
      } catch {
        if (mountedRef.current) {
          showPopup({
            header: t`Clipboard content could not be pasted`,
            message: t`The whiteboard was not changed. Any securely imported images or links remain available in Resources.`,
            icon: "error",
          });
        }
      } finally {
        importInFlightRef.current = false;
        if (mountedRef.current) setIsImporting(false);
      }
    },
    [
      api,
      canEdit,
      insertBatch,
      resolveResource,
      resourceImportBusy,
      resources,
      showPopup,
    ],
  );

  const beginPaste = useCallback(
    (result: CardCanvasClipboardResult) => {
      if (!api || !canEdit || resourceImportBusy || result.items.length === 0) {
        return;
      }
      try {
        assertCardCanvasPasteInputBudget({
          elements: api.getSceneElements(),
          objectCount: result.counts.objects,
          imageSizes: result.items.flatMap((item) =>
            item.type === "image"
              ? [item.source === "file" ? item.file.size : 0]
              : [],
          ),
          resources,
        });
      } catch {
        showPopup({
          header: t`This paste exceeds the whiteboard limits`,
          message: t`Remove some elements or images before pasting this content. No resources were imported.`,
          icon: "error",
        });
        return;
      }
      const pending = { result, anchor: lastAnchorRef.current };
      if (isPublicBoard && navigator.onLine && countResourceItems(result) > 0) {
        setPendingPublicPaste(pending);
        return;
      }
      void applyPaste(pending);
    },
    [
      api,
      applyPaste,
      canEdit,
      isPublicBoard,
      resourceImportBusy,
      resources,
      showPopup,
    ],
  );

  const handlePasteCapture = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>) => {
      const editingText = Boolean(api?.getAppState().editingTextElement);
      if (!canEdit || editingText) return;
      const capture = captureCardCanvasClipboardInput(event);
      if ("error" in capture) {
        if (capture.error instanceof CardCanvasClipboardLimitError) {
          showClipboardRejected();
        } else {
          showPopup({
            header: t`Clipboard content could not be pasted`,
            message: t`The clipboard content was not recognized safely. No changes were made.`,
            icon: "error",
          });
        }
        return;
      }
      const { input } = capture;
      const captureAction = getCardCanvasClipboardCaptureAction({
        canEdit,
        editingText,
        internal: isCardCanvasInternalClipboard(input),
        busy:
          resourceImportBusy ||
          clipboardOperationGateRef.current.busy ||
          importInFlightRef.current,
      });
      if (captureAction === "passthrough") return;
      consumeCardCanvasExternalPaste(event);
      if (captureAction === "block") return;
      try {
        const result = normalizeCardCanvasClipboard(input);
        if (result.items.length === 0) {
          showPopup({
            header: t`Nothing to paste`,
            message: t`Copy text, an image or a link and try again.`,
            icon: "error",
          });
          return;
        }
        beginPaste(result);
      } catch (error) {
        if (error instanceof CardCanvasClipboardLimitError) {
          showClipboardRejected();
        } else {
          showPopup({
            header: t`Clipboard content could not be pasted`,
            message: t`The clipboard content was not recognized safely. No changes were made.`,
            icon: "error",
          });
        }
      }
    },
    [
      api,
      beginPaste,
      canEdit,
      resourceImportBusy,
      showClipboardRejected,
      showPopup,
    ],
  );

  const pasteFromClipboard = useCallback(() => {
    if (
      !canEdit ||
      resourceImportBusy ||
      clipboardOperationGateRef.current.busy ||
      importInFlightRef.current
    ) {
      return;
    }
    const clipboard = (
      navigator as unknown as {
        clipboard?: { read?: Clipboard["read"] };
      }
    ).clipboard;
    const readClipboard = clipboard?.read?.bind(clipboard);
    if (!readClipboard) {
      showPopup({
        header: t`Clipboard access is unavailable`,
        message: t`Use the browser Paste action or Cmd+V inside the whiteboard.`,
        icon: "error",
      });
      return;
    }
    let clipboardOperation: Promise<void> | null;
    try {
      clipboardOperation = clipboardOperationGateRef.current.run(() => {
        setIsReadingClipboard(true);
        return readClipboard()
          .then(readCardCanvasClipboardItems)
          .then((input) => {
            if (!mountedRef.current) return;
            if (isCardCanvasInternalClipboard(input)) {
              showPopup({
                header: t`Use Cmd+V for whiteboard objects`,
                message: t`The Paste button is for content copied from other apps.`,
                icon: "error",
              });
              return;
            }
            const result = normalizeCardCanvasClipboard(input);
            if (result.items.length === 0) {
              showPopup({
                header: t`Nothing to paste`,
                message: t`Copy text, an image or a link and try again.`,
                icon: "error",
              });
              return;
            }
            beginPaste(result);
          })
          .catch((error: unknown) => {
            if (!mountedRef.current) return;
            if (error instanceof CardCanvasClipboardLimitError) {
              showClipboardRejected();
              return;
            }
            showPopup({
              header: t`Clipboard permission was not granted`,
              message: t`No changes were made. You can also use the browser Paste action or Cmd+V.`,
              icon: "error",
            });
          });
      });
    } catch {
      setIsReadingClipboard(false);
      showPopup({
        header: t`Clipboard permission was not granted`,
        message: t`No changes were made. You can also use the browser Paste action or Cmd+V.`,
        icon: "error",
      });
      return;
    }
    if (!clipboardOperation) return;
    void clipboardOperation.finally(() => {
      if (mountedRef.current) setIsReadingClipboard(false);
    });
  }, [
    beginPaste,
    canEdit,
    resourceImportBusy,
    showClipboardRejected,
    showPopup,
  ]);

  const handlePointerDownCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!api || !isCardCanvasPasteAnchorTarget(event.target)) return;
      lastAnchorRef.current = viewportCoordsToSceneCoords(
        { clientX: event.clientX, clientY: event.clientY },
        api.getAppState(),
      );
    },
    [api],
  );

  const confirmPublicPaste = useCallback(() => {
    void resolveCardCanvasPublicPasteDecision({
      approved: true,
      pending: pendingPublicPaste,
      busy: resourceImportBusy,
      apply: applyPaste,
      clear: () => setPendingPublicPaste(null),
    });
  }, [applyPaste, pendingPublicPaste, resourceImportBusy]);

  const cancelPublicPaste = useCallback(() => {
    void resolveCardCanvasPublicPasteDecision({
      approved: false,
      pending: pendingPublicPaste,
      busy: resourceImportBusy,
      apply: applyPaste,
      clear: () => setPendingPublicPaste(null),
    });
  }, [applyPaste, pendingPublicPaste, resourceImportBusy]);

  return {
    handlePasteCapture,
    handlePointerDownCapture,
    pasteFromClipboard,
    pendingPublicPaste,
    pendingPublicResourceCount: pendingPublicPaste
      ? countResourceItems(pendingPublicPaste.result)
      : 0,
    confirmPublicPaste,
    cancelPublicPaste,
    isBusy,
  };
}
