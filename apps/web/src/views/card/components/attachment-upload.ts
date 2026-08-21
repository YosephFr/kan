import {
  isAllowedAttachmentContentType,
  isAttachmentFilenameContentTypeCompatible,
  MAX_ATTACHMENT_SIZE,
  normalizeAttachmentContentType,
} from "@kan/shared/utils";

export { MAX_ATTACHMENT_SIZE };

type AttachmentFile = Pick<File, "arrayBuffer" | "name" | "size" | "type">;

export type AttachmentValidationCode =
  | "empty"
  | "name-too-long"
  | "too-large"
  | "unsupported";

export class AttachmentValidationError extends Error {
  constructor(readonly code: AttachmentValidationCode) {
    super(code);
    this.name = "AttachmentValidationError";
  }
}

export function validateAttachmentFile(file: AttachmentFile): string {
  if (file.size < 1) {
    throw new AttachmentValidationError("empty");
  }
  if (file.name.length > 255) {
    throw new AttachmentValidationError("name-too-long");
  }
  if (file.size > MAX_ATTACHMENT_SIZE) {
    throw new AttachmentValidationError("too-large");
  }

  const contentType = normalizeAttachmentContentType(file.type);
  if (
    !isAllowedAttachmentContentType(contentType) ||
    !isAttachmentFilenameContentTypeCompatible(file.name, contentType)
  ) {
    throw new AttachmentValidationError("unsupported");
  }

  return contentType;
}
