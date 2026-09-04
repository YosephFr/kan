import { MAX_CARD_CANVAS_IMAGE_BYTES } from "@kan/shared";
import {
  isAttachmentFilenameContentTypeCompatible,
  normalizeAttachmentContentType,
} from "@kan/shared/utils";

const WORKSPACE_VISUAL_WALL_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const validateWorkspaceVisualWallImageFile = (
  file: Pick<File, "name" | "size" | "type">,
) => {
  const contentType = normalizeAttachmentContentType(file.type);
  if (
    file.size < 1 ||
    file.size > MAX_CARD_CANVAS_IMAGE_BYTES ||
    file.name.length > 255 ||
    !WORKSPACE_VISUAL_WALL_IMAGE_TYPES.has(contentType) ||
    !isAttachmentFilenameContentTypeCompatible(file.name, contentType)
  ) {
    throw new Error("WORKSPACE_VISUAL_WALL_IMAGE_INVALID");
  }
  return contentType;
};
