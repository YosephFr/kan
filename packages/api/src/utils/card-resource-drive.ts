import { TRPCError } from "@trpc/server";

import type { CardResourceDriveType } from "@kan/db/schema";

export interface NormalizedDriveLink {
  driveType: CardResourceDriveType;
  driveFileId: string;
  resourceKey: string | null;
  openUrl: string;
  previewUrl: string;
}

const driveIdPattern = /^[A-Za-z0-9_-]{10,255}$/;
const resourceKeyPattern = /^[A-Za-z0-9_-]{1,255}$/;

function invalidDriveUrl(): never {
  throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_DRIVE_URL" });
}

function parseSearchParams(url: URL): string | null {
  const seen = new Set<string>();
  let resourceKey: string | null = null;
  for (const [key, value] of url.searchParams) {
    if (seen.has(key) || (key !== "resourcekey" && key !== "usp")) {
      invalidDriveUrl();
    }
    seen.add(key);
    if (key === "resourcekey") {
      if (!resourceKeyPattern.test(value)) invalidDriveUrl();
      resourceKey = value;
    } else if (!resourceKeyPattern.test(value)) {
      invalidDriveUrl();
    }
  }
  return resourceKey;
}

export function buildDriveUrls(input: {
  driveType: CardResourceDriveType;
  driveFileId: string;
  resourceKey: string | null;
}) {
  const base =
    input.driveType === "file"
      ? `https://drive.google.com/file/d/${input.driveFileId}`
      : `https://docs.google.com/${
          input.driveType === "spreadsheet" ? "spreadsheets" : input.driveType
        }/d/${input.driveFileId}`;
  const openUrl = new URL(
    `${base}/${input.driveType === "file" ? "view" : "edit"}`,
  );
  const previewUrl = new URL(`${base}/preview`);
  if (input.resourceKey) {
    openUrl.searchParams.set("resourcekey", input.resourceKey);
    previewUrl.searchParams.set("resourcekey", input.resourceKey);
  }
  return { openUrl: openUrl.href, previewUrl: previewUrl.href };
}

export function normalizeDriveLink(value: string): NormalizedDriveLink {
  if (value !== value.trim()) invalidDriveUrl();
  const authority = /^https:\/\/([^/?#]+)/i.exec(value)?.[1];
  if (!authority || authority.includes(":")) invalidDriveUrl();

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    invalidDriveUrl();
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    invalidDriveUrl();
  }

  const fileMatch =
    url.hostname === "drive.google.com"
      ? /^\/file\/d\/([A-Za-z0-9_-]{10,255})(?:\/(?:view|preview|edit))?\/?$/.exec(
          url.pathname,
        )
      : null;
  const documentMatch =
    url.hostname === "docs.google.com"
      ? /^\/(document|spreadsheets|presentation)\/d\/([A-Za-z0-9_-]{10,255})(?:\/(?:view|preview|edit))?\/?$/.exec(
          url.pathname,
        )
      : null;
  if (!fileMatch && !documentMatch) invalidDriveUrl();

  const driveType: CardResourceDriveType = fileMatch
    ? "file"
    : documentMatch?.[1] === "document"
      ? "document"
      : documentMatch?.[1] === "spreadsheets"
        ? "spreadsheet"
        : "presentation";
  const driveFileId = fileMatch?.[1] ?? documentMatch?.[2];
  if (!driveFileId || !driveIdPattern.test(driveFileId)) invalidDriveUrl();
  const resourceKey = parseSearchParams(url);
  const urls = buildDriveUrls({ driveType, driveFileId, resourceKey });
  return { driveType, driveFileId, resourceKey, ...urls };
}

export function driveFallbackTitle(type: CardResourceDriveType): string {
  if (type === "document") return "Google Docs";
  if (type === "spreadsheet") return "Google Sheets";
  if (type === "presentation") return "Google Slides";
  return "Google Drive file";
}
