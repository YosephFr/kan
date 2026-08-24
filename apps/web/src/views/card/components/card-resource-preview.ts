import type { CardResource } from "./card-resource-types";

export const CARD_RESOURCE_DRIVE_SANDBOX =
  "allow-scripts allow-same-origin" as const;
export const CARD_RESOURCE_REFERRER_POLICY = "no-referrer" as const;

export type CardResourcePreviewKind = "image" | "pdf" | "drive" | "download";

export function getCardResourcePreviewKind(
  resource: CardResource,
): CardResourcePreviewKind {
  if (resource.kind === "drive") return "drive";
  if (resource.contentType.startsWith("image/") && resource.viewUrl) {
    return "image";
  }
  if (resource.contentType === "application/pdf" && resource.viewUrl) {
    return "pdf";
  }
  return "download";
}
