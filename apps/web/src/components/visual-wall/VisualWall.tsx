import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  HiOutlineArrowTopRightOnSquare,
  HiOutlineClipboard,
  HiOutlineLink,
  HiOutlinePhoto,
  HiOutlinePlus,
} from "react-icons/hi2";

import type {
  VisualWallItem,
  VisualWallItemPatch,
  VisualWallProps,
} from "./visual-wall-types";
import { usePopup } from "../../providers/popup";
import Button from "../Button";
import { createVisualWallFrame } from "./visual-wall-frame";
import {
  getVisualWallImageFiles,
  getVisualWallKeyboardAction,
  getVisualWallPointerPatch,
  MAX_VISUAL_WALL_Z_INDEX,
  promoteVisualWallItem,
  toVisualWallItemPatch,
} from "./visual-wall-interactions";
import {
  getVisualWallLogicalHeight,
  getVisualWallScale,
  normalizeVisualWallRect,
  VISUAL_WALL_LOGICAL_WIDTH,
} from "./visual-wall-layout";
import {
  VisualWallFreeformDialog,
  VisualWallPreviewDialog,
} from "./VisualWallDialogs";
import { VisualWallImage } from "./VisualWallImage";

interface PointerOperation {
  publicId: string;
  pointerId: number;
  kind: "move" | "resize";
  clientX: number;
  clientY: number;
  item: VisualWallItem;
  current: VisualWallItemPatch;
  moved: boolean;
  originalZIndex: number;
  scale: number;
}

const patchMatches = (item: VisualWallItem, patch: VisualWallItemPatch) =>
  item.x === patch.x &&
  item.y === patch.y &&
  item.width === patch.width &&
  item.height === patch.height &&
  item.zIndex === patch.zIndex;

export const clearSettledVisualWallPatch = (
  current: Record<string, VisualWallItemPatch>,
  publicId: string,
  settledPatch: VisualWallItemPatch,
) => {
  if (current[publicId] !== settledPatch) return current;
  const next = { ...current };
  delete next[publicId];
  return next;
};

const getClipboardImageFiles = async () => {
  const clipboard = (
    navigator as unknown as {
      clipboard?: { read?: () => Promise<ClipboardItem[]> };
    }
  ).clipboard;
  if (typeof clipboard?.read !== "function") return [];
  const clipboardItems = await clipboard.read();
  const files: File[] = [];
  for (const [index, item] of clipboardItems.entries()) {
    const contentType = item.types.find((type) => type.startsWith("image/"));
    if (!contentType) continue;
    const blob = await item.getType(contentType);
    const extension =
      contentType === "image/jpeg"
        ? "jpg"
        : contentType === "image/png"
          ? "png"
          : "webp";
    files.push(
      new File([blob], `visual-${index + 1}.${extension}`, {
        type: contentType,
      }),
    );
  }
  return files;
};

export function VisualWall({
  items,
  canEdit,
  freeformUrl,
  isBusy = false,
  label,
  emptyMessage = t`Add images to see the project at a glance.`,
  onFiles,
  onUpdate,
  onRemove,
  onSetFreeformUrl,
  onAddFromResources,
}: VisualWallProps) {
  const { showPopup } = usePopup();
  const wallRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const operationRef = useRef<PointerOperation | null>(null);
  const draggedItemRef = useRef<string | null>(null);
  const [selectedPublicId, setSelectedPublicId] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<VisualWallItem | null>(null);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [optimistic, setOptimistic] = useState<
    Record<string, VisualWallItemPatch>
  >({});

  const pointerFrame = useMemo(
    () =>
      createVisualWallFrame<{ publicId: string; patch: VisualWallItemPatch }>(
        ({ publicId, patch }) =>
          setOptimistic((current) => ({ ...current, [publicId]: patch })),
        (callback) => requestAnimationFrame(callback),
        (id) => cancelAnimationFrame(id),
      ),
    [],
  );
  useEffect(() => () => pointerFrame.cancel(), [pointerFrame]);

  useEffect(() => {
    setOptimistic((current) => {
      const next = { ...current };
      let changed = false;
      for (const item of items) {
        const patch = next[item.publicId];
        if (patch && patchMatches(item, patch)) {
          delete next[item.publicId];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [items]);

  const displayedItems = useMemo(
    () =>
      items.map((item) =>
        optimistic[item.publicId]
          ? { ...item, ...optimistic[item.publicId] }
          : item,
      ),
    [items, optimistic],
  );
  const logicalHeight = useMemo(
    () => getVisualWallLogicalHeight(displayedItems),
    [displayedItems],
  );
  const maxZIndex = useMemo(
    () => Math.max(0, ...displayedItems.map((item) => item.zIndex)),
    [displayedItems],
  );

  const persist = useCallback(
    (item: VisualWallItem) => {
      const patch = {
        ...normalizeVisualWallRect(item),
        zIndex: Math.min(
          MAX_VISUAL_WALL_Z_INDEX,
          Math.max(0, Math.round(item.zIndex)),
        ),
      };
      setOptimistic((current) => ({ ...current, [item.publicId]: patch }));
      void Promise.resolve(onUpdate(item.publicId, patch))
        .finally(() => {
          setOptimistic((current) =>
            clearSettledVisualWallPatch(current, item.publicId, patch),
          );
        })
        .catch(() => undefined);
    },
    [onUpdate],
  );

  const startPointerOperation = useCallback(
    (
      event: React.PointerEvent<HTMLElement>,
      item: VisualWallItem,
      kind: PointerOperation["kind"],
    ) => {
      if (!canEdit || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      const promoted = promoteVisualWallItem(item, maxZIndex);
      setSelectedPublicId(item.publicId);
      if (promoted !== item) {
        setOptimistic((current) => ({
          ...current,
          [item.publicId]: toVisualWallItemPatch(promoted),
        }));
      }
      operationRef.current = {
        publicId: item.publicId,
        pointerId: event.pointerId,
        kind,
        clientX: event.clientX,
        clientY: event.clientY,
        item: promoted,
        current: toVisualWallItemPatch(promoted),
        moved: false,
        originalZIndex: item.zIndex,
        scale: getVisualWallScale(
          wallRef.current?.getBoundingClientRect().width ??
            VISUAL_WALL_LOGICAL_WIDTH,
        ),
      };
    },
    [canEdit, maxZIndex],
  );

  const movePointerOperation = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const operation = operationRef.current;
      if (!operation || operation.pointerId !== event.pointerId) return;
      event.preventDefault();
      const { patch, moved } = getVisualWallPointerPatch({
        item: operation.item,
        kind: operation.kind,
        startClientX: operation.clientX,
        startClientY: operation.clientY,
        clientX: event.clientX,
        clientY: event.clientY,
        scale: operation.scale,
      });
      if (!moved && !operation.moved) return;
      if (moved) operation.moved = true;
      operation.current = patch;
      pointerFrame.schedule({ publicId: operation.publicId, patch });
    },
    [pointerFrame],
  );

  const finishPointerOperation = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const operation = operationRef.current;
      if (!operation || operation.pointerId !== event.pointerId) return;
      operationRef.current = null;
      pointerFrame.cancel();
      if (operation.moved && event.type === "pointerup") {
        draggedItemRef.current = operation.publicId;
        window.setTimeout(() => {
          if (draggedItemRef.current === operation.publicId) {
            draggedItemRef.current = null;
          }
        }, 0);
      }
      if (
        operation.moved ||
        operation.item.zIndex !== operation.originalZIndex
      ) {
        persist({ ...operation.item, ...operation.current });
      }
    },
    [persist, pointerFrame],
  );

  const handleFiles = (files: File[]) => {
    const images = getVisualWallImageFiles(files);
    if (images.length > 0) {
      void Promise.resolve(onFiles(images)).catch(() => undefined);
    }
  };

  const removeItem = useCallback(
    (publicId: string) => {
      void Promise.resolve(onRemove(publicId)).catch(() => undefined);
    },
    [onRemove],
  );

  const handleKeyboard = useCallback(
    (event: React.KeyboardEvent, item: VisualWallItem) => {
      const action = getVisualWallKeyboardAction({
        item,
        key: event.key,
        shiftKey: event.shiftKey,
        canEdit,
      });
      if (action.type === "none") return;
      if (action.type === "preview") {
        setPreviewItem(item);
        return;
      }
      event.preventDefault();
      if (action.type === "remove") {
        removeItem(item.publicId);
        return;
      }
      persist(action.item);
    },
    [canEdit, persist, removeItem],
  );

  const openItem = useCallback(
    (item: VisualWallItem) => {
      if (draggedItemRef.current === item.publicId) {
        draggedItemRef.current = null;
        return;
      }
      if (canEdit) setSelectedPublicId(item.publicId);
      setPreviewItem(item);
    },
    [canEdit],
  );

  return (
    <div className="min-w-0" style={{ containerType: "inline-size" }}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {canEdit && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="sr-only"
              onChange={(event) => {
                handleFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              iconLeft={<HiOutlinePhoto className="h-4 w-4" />}
              disabled={isBusy}
              onClick={() => inputRef.current?.click()}
            >
              {t`Add images`}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              iconLeft={<HiOutlineClipboard className="h-4 w-4" />}
              disabled={isBusy}
              onClick={() =>
                void getClipboardImageFiles()
                  .then((files) => {
                    if (files.length > 0) {
                      handleFiles(files);
                      return;
                    }
                    showPopup({
                      header: t`No image was found`,
                      message: t`Copy an image, then press Paste again.`,
                      icon: "error",
                    });
                  })
                  .catch(() =>
                    showPopup({
                      header: t`Clipboard access was not granted`,
                      message: t`Allow clipboard access or use Add images instead.`,
                      icon: "error",
                    }),
                  )
              }
            >
              {t`Paste`}
            </Button>
            {onAddFromResources && (
              <Button
                type="button"
                variant="ghost"
                className="min-h-11"
                iconLeft={<HiOutlinePlus className="h-4 w-4" />}
                disabled={isBusy}
                onClick={onAddFromResources}
              >
                {t`Add from resources`}
              </Button>
            )}
          </>
        )}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {freeformUrl && (
            <a
              href={freeformUrl}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
              className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-semibold text-light-1000 hover:bg-light-300 dark:text-dark-1000 dark:hover:bg-dark-300"
            >
              <HiOutlineArrowTopRightOnSquare className="h-4 w-4" />
              {t`Open in Freeform`}
            </a>
          )}
          {canEdit && (
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              iconLeft={<HiOutlineLink className="h-4 w-4" />}
              disabled={isBusy}
              onClick={() => setLinkDialogOpen(true)}
            >
              {freeformUrl ? t`Change link` : t`Add Freeform link`}
            </Button>
          )}
          {isBusy && (
            <span
              role="status"
              className="text-xs text-light-700 dark:text-dark-700"
            >
              {t`Saving…`}
            </span>
          )}
        </div>
      </div>

      <div
        ref={wallRef}
        role="region"
        aria-label={label}
        aria-busy={isBusy}
        className="relative isolate w-full min-w-0 overflow-hidden border-y border-light-300 bg-light-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:border-dark-300 dark:bg-dark-50 dark:focus-visible:ring-dark-800"
        style={{
          height: `max(480px, ${(logicalHeight / VISUAL_WALL_LOGICAL_WIDTH) * 100}cqw)`,
        }}
        tabIndex={canEdit ? 0 : undefined}
        onClick={() => setSelectedPublicId(null)}
        onPaste={(event) => {
          if (!canEdit) return;
          const files = getVisualWallImageFiles(
            Array.from(event.clipboardData.files),
          );
          if (files.length === 0) return;
          event.preventDefault();
          handleFiles(files);
        }}
        onDragOver={(event) => {
          if (
            canEdit &&
            Array.from(event.dataTransfer.items).some((item) =>
              item.type.startsWith("image/"),
            )
          ) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(event) => {
          if (!canEdit) return;
          event.preventDefault();
          handleFiles(Array.from(event.dataTransfer.files));
        }}
      >
        {displayedItems.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-light-700 dark:text-dark-700">
            {emptyMessage}
          </div>
        )}
        {displayedItems.map((item) => (
          <VisualWallImage
            key={item.publicId}
            item={item}
            selected={selectedPublicId === item.publicId}
            canEdit={canEdit}
            onOpen={openItem}
            onPreview={setPreviewItem}
            onRemove={removeItem}
            onPersist={persist}
            onKeyboard={handleKeyboard}
            onStart={startPointerOperation}
            onMove={movePointerOperation}
            onFinish={finishPointerOperation}
          />
        ))}
      </div>

      <VisualWallPreviewDialog
        item={previewItem}
        onClose={() => setPreviewItem(null)}
      />
      <VisualWallFreeformDialog
        open={linkDialogOpen}
        currentUrl={freeformUrl}
        busy={isBusy}
        onClose={() => setLinkDialogOpen(false)}
        onSave={onSetFreeformUrl}
      />
    </div>
  );
}

export type {
  VisualWallItem,
  VisualWallItemPatch,
  VisualWallProps,
} from "./visual-wall-types";
