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

export const isWebLinkVisibilityAcknowledgementError = (error: unknown) =>
  error instanceof Error &&
  error.message.includes("PUBLIC_VISIBILITY_ACKNOWLEDGEMENT_REQUIRED");

export const isWebLinkLimitError = (error: unknown) =>
  error instanceof Error &&
  error.message.includes("WEB_RESOURCE_LIMIT_REACHED");
