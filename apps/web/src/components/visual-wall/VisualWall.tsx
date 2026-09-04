import Image from "next/image";
import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  HiOutlineArrowTopRightOnSquare,
  HiOutlineClipboard,
  HiOutlineEye,
  HiOutlineLink,
  HiOutlinePhoto,
  HiOutlinePlus,
  HiOutlineTrash,
} from "react-icons/hi2";

import type {
  VisualWallItem,
  VisualWallItemPatch,
  VisualWallProps,
} from "./visual-wall-types";
import { usePopup } from "../../providers/popup";
import Button from "../Button";
import {
  getVisualWallImageFiles,
  getVisualWallKeyboardAction,
  getVisualWallKeyboardResize,
  getVisualWallPointerPatch,
  MAX_VISUAL_WALL_Z_INDEX,
  promoteVisualWallItem,
  toVisualWallItemPatch,
} from "./visual-wall-interactions";
import {
  getVisualWallLogicalHeight,
  getVisualWallScale,
  normalizeVisualWallRect,
} from "./visual-wall-layout";
import {
  VisualWallFreeformDialog,
  VisualWallPreviewDialog,
} from "./VisualWallDialogs";

interface PointerOperation {
  publicId: string;
  pointerId: number;
  kind: "move" | "resize";
  clientX: number;
  clientY: number;
  item: VisualWallItem;
  current: VisualWallItemPatch;
  moved: boolean;
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
  const [renderedWidth, setRenderedWidth] = useState(1_200);
  const [selectedPublicId, setSelectedPublicId] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<VisualWallItem | null>(null);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [optimistic, setOptimistic] = useState<
    Record<string, VisualWallItemPatch>
  >({});

  useEffect(() => {
    const wall = wallRef.current;
    if (!wall) return;
    const update = () => setRenderedWidth(wall.getBoundingClientRect().width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(wall);
    return () => observer.disconnect();
  }, []);

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
  const scale = getVisualWallScale(renderedWidth);
  const logicalHeight = getVisualWallLogicalHeight(displayedItems);
  const maxZIndex = Math.max(0, ...displayedItems.map((item) => item.zIndex));

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

  const startPointerOperation = (
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
    setOptimistic((current) => ({
      ...current,
      [item.publicId]: toVisualWallItemPatch(promoted),
    }));
    operationRef.current = {
      publicId: item.publicId,
      pointerId: event.pointerId,
      kind,
      clientX: event.clientX,
      clientY: event.clientY,
      item: promoted,
      current: toVisualWallItemPatch(promoted),
      moved: false,
    };
  };

  const movePointerOperation = (event: React.PointerEvent<HTMLElement>) => {
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
      scale,
    });
    if (moved) operation.moved = true;
    operation.current = patch;
    setOptimistic((current) => ({
      ...current,
      [operation.publicId]: patch,
    }));
  };

  const finishPointerOperation = (event: React.PointerEvent<HTMLElement>) => {
    const operation = operationRef.current;
    if (!operation || operation.pointerId !== event.pointerId) return;
    operationRef.current = null;
    if (operation.moved && event.type === "pointerup") {
      draggedItemRef.current = operation.publicId;
      window.setTimeout(() => {
        if (draggedItemRef.current === operation.publicId) {
          draggedItemRef.current = null;
        }
      }, 0);
    }
    persist({ ...operation.item, ...operation.current });
  };

  const handleFiles = (files: File[]) => {
    const images = getVisualWallImageFiles(files);
    if (images.length > 0) {
      void Promise.resolve(onFiles(images)).catch(() => undefined);
    }
  };

  const removeItem = (publicId: string) => {
    void Promise.resolve(onRemove(publicId)).catch(() => undefined);
  };

  const handleKeyboard = (event: React.KeyboardEvent, item: VisualWallItem) => {
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
  };

  return (
    <div className="min-w-0">
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
        style={{ height: Math.max(480, logicalHeight * scale) }}
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
        {displayedItems.map((item) => {
          const selected = selectedPublicId === item.publicId;
          return (
            <div
              key={item.publicId}
              role="group"
              tabIndex={0}
              aria-label={item.title}
              className={`group absolute select-none outline-none ${selected ? "ring-2 ring-light-1000 ring-offset-2 dark:ring-dark-1000 dark:ring-offset-dark-50" : "focus-visible:ring-2 focus-visible:ring-light-900 dark:focus-visible:ring-dark-900"}`}
              style={{
                left: item.x * scale,
                top: item.y * scale,
                width: item.width * scale,
                height: item.height * scale,
                zIndex: item.zIndex,
                touchAction: canEdit ? "none" : "auto",
                cursor: canEdit ? "move" : "zoom-in",
              }}
              onClick={(event) => {
                event.stopPropagation();
                if (draggedItemRef.current === item.publicId) {
                  draggedItemRef.current = null;
                  return;
                }
                if (canEdit) setSelectedPublicId(item.publicId);
                setPreviewItem(item);
              }}
              onDoubleClick={() => setPreviewItem(item)}
              onKeyDown={(event) => handleKeyboard(event, item)}
              onPointerDown={(event) =>
                startPointerOperation(event, item, "move")
              }
              onPointerMove={movePointerOperation}
              onPointerUp={finishPointerOperation}
              onPointerCancel={finishPointerOperation}
            >
              <Image
                src={item.viewUrl}
                alt=""
                width={Math.max(1, Math.round(item.width))}
                height={Math.max(1, Math.round(item.height))}
                unoptimized
                loading="lazy"
                decoding="async"
                draggable={false}
                className="h-full w-full bg-light-100 object-contain shadow-sm dark:bg-dark-100"
              />
              {selected && canEdit && (
                <div className="absolute right-2 top-2 flex h-11 items-center overflow-hidden rounded-md border border-light-500 bg-light-50 shadow-lg dark:border-dark-500 dark:bg-dark-100">
                  <button
                    type="button"
                    className="flex h-11 w-11 items-center justify-center hover:bg-light-300 dark:hover:bg-dark-300"
                    onPointerDown={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      setPreviewItem(item);
                    }}
                    aria-label={t`Preview image`}
                  >
                    <HiOutlineEye className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    className="flex h-11 w-11 items-center justify-center text-red-800 hover:bg-red-200 dark:text-red-800 dark:hover:bg-red-300"
                    onPointerDown={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      removeItem(item.publicId);
                    }}
                    aria-label={t`Remove image from wall`}
                  >
                    <HiOutlineTrash className="h-5 w-5" />
                  </button>
                </div>
              )}
              {selected && canEdit && (
                <button
                  type="button"
                  aria-label={t`Resize image`}
                  className="absolute bottom-2 right-2 h-11 w-11 cursor-nwse-resize touch-none rounded-full border-2 border-light-1000 bg-light-50 shadow-md dark:border-dark-1000 dark:bg-dark-50"
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    const resized = getVisualWallKeyboardResize({
                      item,
                      key: event.key,
                      shiftKey: event.shiftKey,
                    });
                    if (!resized) return;
                    event.preventDefault();
                    persist(resized);
                  }}
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) =>
                    startPointerOperation(event, item, "resize")
                  }
                  onPointerMove={movePointerOperation}
                  onPointerUp={finishPointerOperation}
                  onPointerCancel={finishPointerOperation}
                />
              )}
            </div>
          );
        })}
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
