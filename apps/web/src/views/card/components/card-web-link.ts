import type { ClipboardData } from "@excalidraw/excalidraw/clipboard";

export const normalizeCardWebLink = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048 || /\s/.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (
      url.protocol !== "https:" ||
      url.username.length > 0 ||
      url.password.length > 0
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
};

export const getSingleHttpsClipboardUrl = (data: ClipboardData) => {
  if (
    data.spreadsheet ||
    (data.files && Object.keys(data.files).length > 0) ||
    (data.elements && data.elements.length > 0) ||
    data.mixedContent?.some((item) => item.type === "imageUrl")
  ) {
    return null;
  }
  return data.text ? normalizeCardWebLink(data.text) : null;
};

export const getCardCanvasPastedWebLink = (
  data: ClipboardData,
  editingText: boolean,
) => (editingText ? null : getSingleHttpsClipboardUrl(data));

export const isWebLinkVisibilityAcknowledgementError = (error: unknown) =>
  error instanceof Error &&
  error.message.includes("PUBLIC_VISIBILITY_ACKNOWLEDGEMENT_REQUIRED");

export const isWebLinkLimitError = (error: unknown) =>
  error instanceof Error &&
  error.message.includes("WEB_RESOURCE_LIMIT_REACHED");
