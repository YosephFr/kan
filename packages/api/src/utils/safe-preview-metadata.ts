import { normalizeSafePreviewUrl } from "./safe-preview-network";
import { SAFE_PREVIEW_LIMITS } from "./safe-preview-types";

export interface ExtractedSafePreviewMetadata {
  title: string;
  siteName: string;
  description: string | null;
  imageUrl: string | null;
}

const namedEntities: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

const decodeEntities = (value: string) =>
  value.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi, (entity, key: string) => {
    if (!key.startsWith("#")) {
      return namedEntities[key.toLowerCase()] ?? entity;
    }
    const hexadecimal = key[1]?.toLowerCase() === "x";
    const codePoint = Number.parseInt(
      key.slice(hexadecimal ? 2 : 1),
      hexadecimal ? 16 : 10,
    );
    if (
      !Number.isFinite(codePoint) ||
      codePoint <= 0 ||
      codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      return "";
    }
    return String.fromCodePoint(codePoint);
  });

const isSafeTextCharacter = (character: string) => {
  const codePoint = character.codePointAt(0) ?? 0;
  return !(
    codePoint <= 8 ||
    codePoint === 11 ||
    codePoint === 12 ||
    (codePoint >= 14 && codePoint <= 31) ||
    (codePoint >= 127 && codePoint <= 159) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
};

const sanitizeText = (value: string, maximum: number) => {
  const normalized = Array.from(decodeEntities(value).replace(/<[^>]*>/g, " "))
    .filter(isSafeTextCharacter)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(normalized).slice(0, maximum).join("");
};

const parseAttributes = (tag: string) => {
  const attributes = new Map<string, string>();
  const pattern =
    /([^\s=/>]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tag))) {
    const name = match[1]?.toLowerCase();
    if (!name || name === "meta") continue;
    attributes.set(name, match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
};

const extractMeta = (html: string) => {
  const values = new Map<string, string>();
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    const key = (
      attributes.get("property") ??
      attributes.get("name") ??
      ""
    ).toLowerCase();
    const content = attributes.get("content");
    if (key && content !== undefined && !values.has(key)) {
      values.set(key, content);
    }
  }
  return values;
};

const firstText = (
  candidates: readonly (string | undefined)[],
  maximum: number,
) => {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const value = sanitizeText(candidate, maximum);
    if (value) return value;
  }
  return null;
};

export const extractSafePreviewMetadata = (
  html: string,
  resolvedUrl: string,
): ExtractedSafePreviewMetadata => {
  const meta = extractMeta(html);
  const titleElement = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1];
  const fallback = new URL(resolvedUrl).hostname.replace(/^www\./i, "");
  const title =
    firstText(
      [meta.get("og:title"), meta.get("twitter:title"), titleElement],
      SAFE_PREVIEW_LIMITS.titleCharacters,
    ) ?? fallback;
  const siteName =
    firstText(
      [meta.get("og:site_name")],
      SAFE_PREVIEW_LIMITS.titleCharacters,
    ) ?? fallback;
  const description = firstText(
    [
      meta.get("og:description"),
      meta.get("twitter:description"),
      meta.get("description"),
    ],
    SAFE_PREVIEW_LIMITS.descriptionCharacters,
  );
  const imageValue = firstText(
    [
      meta.get("og:image:secure_url"),
      meta.get("og:image"),
      meta.get("twitter:image"),
      meta.get("twitter:image:src"),
    ],
    SAFE_PREVIEW_LIMITS.urlBytes,
  );
  let imageUrl: string | null = null;
  if (imageValue) {
    try {
      imageUrl = normalizeSafePreviewUrl(
        new URL(imageValue, resolvedUrl).toString(),
      );
    } catch {
      imageUrl = null;
    }
  }
  return { title, siteName, description, imageUrl };
};
