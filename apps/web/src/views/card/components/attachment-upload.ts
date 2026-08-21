import {
  isAllowedAttachmentContentType,
  isAttachmentFilenameContentTypeCompatible,
  MAX_ATTACHMENT_SIZE,
  normalizeAttachmentContentType,
} from "@kan/shared/utils";

export { MAX_ATTACHMENT_SIZE };

type AttachmentFile = Pick<File, "arrayBuffer" | "name" | "size" | "type">;

export interface AttachmentUploadInput {
  cardPublicId: string;
  filename: string;
  contentType: string;
  size: number;
  sha256: string;
}

export type AttachmentValidationCode = "empty" | "too-large" | "unsupported";

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

export async function prepareAttachmentUpload<T>(
  file: AttachmentFile,
  cardPublicId: string,
  createUploadSession: (input: AttachmentUploadInput) => Promise<T>,
): Promise<{ contentType: string; uploadSession: T }> {
  const contentType = validateAttachmentFile(file);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  const sha256 = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

  return {
    contentType,
    uploadSession: await createUploadSession({
      cardPublicId,
      filename: file.name,
      contentType,
      size: file.size,
      sha256,
    }),
  };
}
