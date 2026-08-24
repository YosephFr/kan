import type { CardCanvasClipboardItem } from "./card-canvas-clipboard";
import type { CardCanvasPasteBatchItem } from "./card-canvas-paste-batch";
import type { CardResource } from "./card-resource-types";

export type CardCanvasResolvedPasteItem = CardCanvasPasteBatchItem;

export const resolveCardCanvasClipboardItems = async ({
  items,
  online,
  publicVisibilityAcknowledged,
  resolveResource,
  shouldContinue = () => true,
  validateResolvedItems,
}: {
  items: readonly CardCanvasClipboardItem[];
  online: boolean;
  publicVisibilityAcknowledged?: boolean;
  resolveResource: (
    item: Exclude<CardCanvasClipboardItem, { type: "text" }>,
    publicVisibilityAcknowledged?: boolean,
  ) => Promise<CardResource>;
  shouldContinue?: () => boolean;
  validateResolvedItems?: (
    items: readonly CardCanvasResolvedPasteItem[],
  ) => void;
}) => {
  const resolved: CardCanvasResolvedPasteItem[] = [];
  let skipped = 0;
  for (const item of items) {
    if (!shouldContinue()) {
      return { items: [], skipped, cancelled: true };
    }
    if (item.type === "text") {
      resolved.push({ kind: "text", text: item.text });
      continue;
    }
    if (!online) {
      skipped += 1;
      continue;
    }
    let resource: CardResource;
    try {
      resource = await resolveResource(item, publicVisibilityAcknowledged);
    } catch {
      skipped += 1;
      continue;
    }
    if (!shouldContinue()) {
      return { items: [], skipped, cancelled: true };
    }
    const candidate = { kind: "resource", resource } as const;
    const next = [...resolved, candidate];
    validateResolvedItems?.(next);
    resolved.push(candidate);
  }
  return shouldContinue()
    ? { items: resolved, skipped, cancelled: false }
    : { items: [], skipped, cancelled: true };
};
