import Image from "next/image";
import { t } from "@lingui/core/macro";
import { memo } from "react";
import { HiOutlineEye, HiOutlineTrash } from "react-icons/hi2";

import type { VisualWallItem } from "./visual-wall-types";
import { getVisualWallKeyboardResize } from "./visual-wall-interactions";
import {
  getVisualWallImageDimensions,
  VISUAL_WALL_LOGICAL_WIDTH,
} from "./visual-wall-layout";

interface Props {
  item: VisualWallItem;
  selected: boolean;
  canEdit: boolean;
  onOpen: (item: VisualWallItem) => void;
  onPreview: (item: VisualWallItem) => void;
  onRemove: (publicId: string) => void;
  onPersist: (item: VisualWallItem) => void;
  onKeyboard: (event: React.KeyboardEvent, item: VisualWallItem) => void;
  onStart: (
    event: React.PointerEvent<HTMLElement>,
    item: VisualWallItem,
    kind: "move" | "resize",
  ) => void;
  onMove: (event: React.PointerEvent<HTMLElement>) => void;
  onFinish: (event: React.PointerEvent<HTMLElement>) => void;
}

export const VisualWallImage = memo(function VisualWallImage({
  item,
  selected,
  canEdit,
  onOpen,
  onPreview,
  onRemove,
  onPersist,
  onKeyboard,
  onStart,
  onMove,
  onFinish,
}: Props) {
  const unit = 100 / VISUAL_WALL_LOGICAL_WIDTH;
  const dimensions = getVisualWallImageDimensions(item);
  return (
    <div
      role="group"
      tabIndex={0}
      aria-label={item.title}
      className={`group absolute select-none outline-none ${selected ? "ring-2 ring-light-1000 ring-offset-2 dark:ring-dark-1000 dark:ring-offset-dark-50" : "focus-visible:ring-2 focus-visible:ring-light-900 dark:focus-visible:ring-dark-900"}`}
      style={{
        left: 0,
        top: 0,
        transform: `translate(${item.x * unit}cqw, ${item.y * unit}cqw)`,
        width: `${item.width * unit}%`,
        aspectRatio: `${item.width} / ${item.height}`,
        zIndex: item.zIndex,
        touchAction: canEdit ? "none" : "auto",
        cursor: canEdit ? "move" : "zoom-in",
        contentVisibility: selected ? "visible" : "auto",
      }}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(item);
      }}
      onKeyDown={(event) => onKeyboard(event, item)}
      onPointerDown={(event) => onStart(event, item, "move")}
      onPointerMove={onMove}
      onPointerUp={onFinish}
      onPointerCancel={onFinish}
    >
      <Image
        src={item.viewUrl}
        alt=""
        width={dimensions.width}
        height={dimensions.height}
        unoptimized
        loading="lazy"
        decoding="async"
        draggable={false}
        className="h-full w-full bg-light-100 object-contain shadow-sm dark:bg-dark-100"
      />
      {selected && canEdit && (
        <>
          <div className="absolute right-2 top-2 flex h-11 items-center overflow-hidden rounded-md border border-light-500 bg-light-50 shadow-lg dark:border-dark-500 dark:bg-dark-100">
            <button
              type="button"
              className="flex h-11 w-11 items-center justify-center hover:bg-light-300 dark:hover:bg-dark-300"
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onPreview(item);
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
                onRemove(item.publicId);
              }}
              aria-label={t`Remove image from wall`}
            >
              <HiOutlineTrash className="h-5 w-5" />
            </button>
          </div>
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
              onPersist(resized);
            }}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => onStart(event, item, "resize")}
            onPointerMove={onMove}
            onPointerUp={onFinish}
            onPointerCancel={onFinish}
          />
        </>
      )}
    </div>
  );
});
