import { MAX_CARD_CANVAS_IMAGE_BYTES } from "@kan/shared";
import {
  isAttachmentFilenameContentTypeCompatible,
  normalizeAttachmentContentType,
} from "@kan/shared/utils";

import type { CardCanvasClipboardItem } from "~/views/card/components/card-canvas-clipboard";

const WORKSPACE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const validateWorkspaceCanvasImageFile = (
  file: Pick<File, "name" | "size" | "type">,
) => {
  const contentType = normalizeAttachmentContentType(file.type);
  if (
    file.size < 1 ||
    file.size > MAX_CARD_CANVAS_IMAGE_BYTES ||
    file.name.length > 255 ||
    !WORKSPACE_IMAGE_TYPES.has(contentType) ||
    !isAttachmentFilenameContentTypeCompatible(file.name, contentType)
  ) {
    throw new Error("WORKSPACE_CANVAS_IMAGE_INVALID");
  }
  return contentType;
};

export const toWorkspaceCanvasPasteText = (item: {
  type: "text" | "link";
  text?: string;
  label?: string;
  url?: string;
}) =>
  item.type === "text"
    ? (item.text ?? "")
    : item.label
      ? `${item.label}\n${item.url ?? ""}`
      : (item.url ?? "");

export const makeWorkspaceCanvasFilePasteItems = (
  files: readonly File[],
): CardCanvasClipboardItem[] =>
  files.map((file) => ({ type: "image", source: "file", file }));
