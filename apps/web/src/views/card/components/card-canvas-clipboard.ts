import {
  MAX_CARD_CANVAS_IMAGE_BYTES,
  MAX_CARD_CANVAS_TOTAL_IMAGE_BYTES,
} from "@kan/shared";

import { normalizeCardWebLink } from "./card-web-link";

export const MAX_CARD_CANVAS_CLIPBOARD_BYTES = 256 * 1024;
export const MAX_CARD_CANVAS_CLIPBOARD_OBJECTS = 20;
export const MAX_CARD_CANVAS_CLIPBOARD_IMAGES = 10;
export const MAX_CARD_CANVAS_CLIPBOARD_LINKS = 10;

export type CardCanvasClipboardLimitCode =
  | "CLIPBOARD_CONTENT_TOO_LARGE"
  | "CLIPBOARD_OBJECT_LIMIT_REACHED"
  | "CLIPBOARD_IMAGE_LIMIT_REACHED"
  | "CLIPBOARD_LINK_LIMIT_REACHED";

export class CardCanvasClipboardLimitError extends Error {
  readonly code: CardCanvasClipboardLimitCode;

  constructor(code: CardCanvasClipboardLimitCode) {
    super(code);
    this.name = "CardCanvasClipboardLimitError";
    this.code = code;
  }
}

export interface CardCanvasClipboardImageInput {
  file: File;
  sourceUrl?: string;
}

export interface CardCanvasClipboardInput {
  text?: string;
  html?: string;
  uriList?: string;
  images?: readonly CardCanvasClipboardImageInput[];
  formats?: readonly string[];
}

export type CardCanvasClipboardItem =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image";
      source: "file";
      file: File;
      sourceUrl?: string;
    }
  | {
      type: "image";
      source: "url";
      url: string;
      altText?: string;
    }
  | {
      type: "link";
      url: string;
      label?: string;
    };

export interface CardCanvasClipboardResult {
  items: CardCanvasClipboardItem[];
  counts: {
    objects: number;
    images: number;
    links: number;
  };
}

const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

const IGNORED_TAGS = new Set([
  "canvas",
  "head",
  "iframe",
  "noscript",
  "object",
  "script",
  "style",
  "svg",
  "template",
]);

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  hellip: "…",
  lt: "<",
  mdash: "—",
  nbsp: " ",
  ndash: "–",
  quot: '"',
};

const EXCALIDRAW_CLIPBOARD_FORMATS = new Set([
  "application/vnd.excalidraw+json",
  "application/vnd.excalidrawlib+json",
]);

const EXCALIDRAW_CLIPBOARD_PREFIX =
  /^\{\s*"type"\s*:\s*"(?:excalidraw|excalidraw\/clipboard|excalidraw-api\/clipboard)"/;

export const isCardCanvasInternalClipboard = (
  input: Pick<CardCanvasClipboardInput, "formats" | "text">,
) =>
  input.formats?.some((format) => EXCALIDRAW_CLIPBOARD_FORMATS.has(format)) ===
    true ||
  EXCALIDRAW_CLIPBOARD_PREFIX.test(input.text?.trimStart().slice(0, 256) ?? "");

const decodeHtmlEntities = (value: string) =>
  value.replace(
    /&(#(?:x[0-9a-f]+|[0-9]+)|[a-z][a-z0-9]+);/gi,
    (entity, key: string) => {
      if (key.startsWith("#")) {
        const hexadecimal = key[1]?.toLowerCase() === "x";
        const codePoint = Number.parseInt(
          key.slice(hexadecimal ? 2 : 1),
          hexadecimal ? 16 : 10,
        );
        if (
          !Number.isFinite(codePoint) ||
          codePoint <= 0 ||
          codePoint > 0x10ffff
        ) {
          return entity;
        }
        return String.fromCodePoint(codePoint);
      }
      return NAMED_ENTITIES[key.toLowerCase()] ?? entity;
    },
  );

const removeControlCharacters = (value: string) => {
  let cleaned = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint <= 8 ||
      codePoint === 11 ||
      codePoint === 12 ||
      (codePoint >= 14 && codePoint <= 31) ||
      codePoint === 127
    ) {
      continue;
    }
    cleaned += character;
  }
  return cleaned;
};

const cleanClipboardText = (value: string) =>
  removeControlCharacters(decodeHtmlEntities(value))
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t \f\v]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const assertClipboardTextSize = (values: readonly (string | undefined)[]) => {
  let bytes = 0;
  for (const value of values) {
    if (!value) continue;
    if (value.length + bytes > MAX_CARD_CANVAS_CLIPBOARD_BYTES) {
      throw new CardCanvasClipboardLimitError("CLIPBOARD_CONTENT_TOO_LARGE");
    }
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      else if (
        code >= 0xd800 &&
        code <= 0xdbff &&
        value.charCodeAt(index + 1) >= 0xdc00 &&
        value.charCodeAt(index + 1) <= 0xdfff
      ) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
      if (bytes > MAX_CARD_CANVAS_CLIPBOARD_BYTES) {
        throw new CardCanvasClipboardLimitError("CLIPBOARD_CONTENT_TOO_LARGE");
      }
    }
  }
};

const addClipboardImageBytes = (totalBytes: number, imageBytes: number) => {
  if (
    imageBytes > MAX_CARD_CANVAS_IMAGE_BYTES ||
    totalBytes > MAX_CARD_CANVAS_TOTAL_IMAGE_BYTES - imageBytes
  ) {
    throw new CardCanvasClipboardLimitError("CLIPBOARD_CONTENT_TOO_LARGE");
  }
  return totalBytes + imageBytes;
};

const getTagEnd = (html: string, start: number) => {
  let quote = "";
  for (let index = start; index < html.length; index += 1) {
    const character = html[index] ?? "";
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
};

const getAttribute = (tag: string, name: string) => {
  const pattern =
    /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tag))) {
    if (match[1]?.toLowerCase() === name) {
      return decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? "");
    }
  }
  return undefined;
};

const TAG_NAME_PATTERN = /^([a-z][a-z0-9:-]*)/i;

const HIDDEN_STYLE_PATTERN =
  /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)(?:\s*!important)?\s*(?:;|$)/i;

const getInlinePixelSize = (style: string | undefined, property: string) => {
  if (!style) return null;
  const match = new RegExp(
    `(?:^|;)\\s*${property}\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)px(?:\\s*!important)?\\s*(?:;|$)`,
    "i",
  ).exec(style);
  return match ? Number.parseFloat(match[1] ?? "") : null;
};

const getAttributePixelSize = (tag: string, name: string) => {
  const value = getAttribute(tag, name);
  if (
    value === undefined ||
    !/^\s*[0-9]+(?:\.[0-9]+)?(?:px)?\s*$/i.test(value)
  ) {
    return null;
  }
  return Number.parseFloat(value);
};

const isHiddenClipboardElement = (tag: string) => {
  const ariaHidden = getAttribute(tag, "aria-hidden")?.trim().toLowerCase();
  const style = getAttribute(tag, "style");
  return (
    getAttribute(tag, "hidden") !== undefined ||
    ariaHidden === "true" ||
    (style !== undefined && HIDDEN_STYLE_PATTERN.test(style))
  );
};

const isTrackingPixel = (tag: string) => {
  const style = getAttribute(tag, "style");
  const width =
    getAttributePixelSize(tag, "width") ?? getInlinePixelSize(style, "width");
  const height =
    getAttributePixelSize(tag, "height") ?? getInlinePixelSize(style, "height");
  return width !== null && height !== null && width <= 1 && height <= 1;
};

const parseCardCanvasClipboardHtml = (html: string) => {
  const items: CardCanvasClipboardItem[] = [];
  const seenLinks = new Set<string>();
  const seenImages = new Set<string>();
  const suppressedTags: string[] = [];
  let text = "";
  let anchor: { url: string | null; text: string } | null = null;

  const addItem = (item: CardCanvasClipboardItem) => {
    const imageCount =
      items.filter((current) => current.type === "image").length +
      (item.type === "image" ? 1 : 0);
    const linkCount =
      items.filter((current) => current.type === "link").length +
      (item.type === "link" ? 1 : 0);
    if (imageCount > MAX_CARD_CANVAS_CLIPBOARD_IMAGES) {
      throw new CardCanvasClipboardLimitError("CLIPBOARD_IMAGE_LIMIT_REACHED");
    }
    if (linkCount > MAX_CARD_CANVAS_CLIPBOARD_LINKS) {
      throw new CardCanvasClipboardLimitError("CLIPBOARD_LINK_LIMIT_REACHED");
    }
    if (items.length + 1 > MAX_CARD_CANVAS_CLIPBOARD_OBJECTS) {
      throw new CardCanvasClipboardLimitError("CLIPBOARD_OBJECT_LIMIT_REACHED");
    }
    items.push(item);
  };

  const appendText = (value: string) => {
    if (anchor) anchor.text += value;
    else text += value;
  };
  const flushText = () => {
    const cleaned = cleanClipboardText(text);
    text = "";
    if (cleaned) addItem({ type: "text", text: cleaned });
  };
  const finishAnchor = () => {
    if (!anchor) return;
    const current = anchor;
    anchor = null;
    const label = cleanClipboardText(current.text);
    if (current.url && !seenLinks.has(current.url)) {
      flushText();
      seenLinks.add(current.url);
      addItem({
        type: "link",
        url: current.url,
        ...(label ? { label } : {}),
      });
    } else if (label) {
      text += label;
    }
  };
  const addBreak = () => appendText("\n");

  let cursor = 0;
  while (cursor < html.length) {
    const tagStart = html.indexOf("<", cursor);
    if (tagStart === -1) {
      if (suppressedTags.length === 0) appendText(html.slice(cursor));
      break;
    }
    if (suppressedTags.length === 0 && tagStart > cursor) {
      appendText(html.slice(cursor, tagStart));
    }
    if (html.startsWith("<!--", tagStart)) {
      const commentEnd = html.indexOf("-->", tagStart + 4);
      cursor = commentEnd === -1 ? html.length : commentEnd + 3;
      continue;
    }
    const tagEnd = getTagEnd(html, tagStart + 1);
    if (tagEnd === -1) {
      if (suppressedTags.length === 0) appendText(html.slice(tagStart));
      break;
    }
    const rawTag = html.slice(tagStart + 1, tagEnd).trim();
    const closing = rawTag.startsWith("/");
    const tagName = TAG_NAME_PATTERN.exec(
      rawTag.slice(closing ? 1 : 0),
    )?.[1]?.toLowerCase();
    cursor = tagEnd + 1;
    if (!tagName) continue;
    const selfClosing = rawTag.endsWith("/") || VOID_TAGS.has(tagName);

    if (suppressedTags.length > 0) {
      if (!closing && !selfClosing) {
        suppressedTags.push(tagName);
      } else if (closing) {
        const matchIndex = suppressedTags.lastIndexOf(tagName);
        if (matchIndex !== -1) suppressedTags.length = matchIndex;
      }
      continue;
    }
    if (
      !closing &&
      (IGNORED_TAGS.has(tagName) || isHiddenClipboardElement(rawTag))
    ) {
      if (!selfClosing) suppressedTags.push(tagName);
      continue;
    }
    if (tagName === "br") {
      addBreak();
      continue;
    }
    if (tagName === "a") {
      if (closing) {
        finishAnchor();
      } else {
        finishAnchor();
        const href = getAttribute(rawTag, "href");
        const url = href ? normalizeCardWebLink(href) : null;
        if (url) flushText();
        anchor = { url, text: "" };
      }
      continue;
    }
    if (!closing && tagName === "img") {
      if (isTrackingPixel(rawTag)) continue;
      const src = getAttribute(rawTag, "src");
      const url = src ? normalizeCardWebLink(src) : null;
      if (url && !seenImages.has(url)) {
        flushText();
        seenImages.add(url);
        const altText = cleanClipboardText(getAttribute(rawTag, "alt") ?? "");
        addItem({
          type: "image",
          source: "url",
          url,
          ...(altText ? { altText } : {}),
        });
      }
      continue;
    }
    if (BLOCK_TAGS.has(tagName)) addBreak();
  }
  finishAnchor();
  flushText();
  return items;
};

const normalizeBinaryImages = (
  images: readonly CardCanvasClipboardImageInput[],
) => {
  const seenFiles = new Set<File>();
  const seenSourceUrls = new Set<string>();
  return images.flatMap<CardCanvasClipboardItem>((image) => {
    const sourceUrl = image.sourceUrl
      ? normalizeCardWebLink(image.sourceUrl)
      : null;
    if (
      seenFiles.has(image.file) ||
      (sourceUrl !== null && seenSourceUrls.has(sourceUrl))
    ) {
      return [];
    }
    seenFiles.add(image.file);
    if (sourceUrl) seenSourceUrls.add(sourceUrl);
    return [
      {
        type: "image",
        source: "file",
        file: image.file,
        ...(sourceUrl ? { sourceUrl } : {}),
      },
    ];
  });
};

const combineImagesWithHtml = (
  binaryImages: CardCanvasClipboardItem[],
  htmlItems: CardCanvasClipboardItem[],
) => {
  const remaining = [...binaryImages];
  const htmlImageCount = htmlItems.filter(
    (item) => item.type === "image" && item.source === "url",
  ).length;
  let exactMatches = 0;
  const combined = htmlItems.map((item) => {
    if (item.type !== "image" || item.source !== "url") return item;
    const exactIndex = remaining.findIndex(
      (candidate) =>
        candidate.type === "image" &&
        candidate.source === "file" &&
        candidate.sourceUrl === item.url,
    );
    if (exactIndex === -1) return item;
    exactMatches += 1;
    return remaining.splice(exactIndex, 1)[0] ?? item;
  });
  const remoteImages = combined.filter(
    (item) => item.type === "image" && item.source === "url",
  );
  if (
    remaining.length > 0 &&
    exactMatches === 0 &&
    remaining.length === remoteImages.length
  ) {
    let nextBinary = 0;
    return combined.map((item) =>
      item.type === "image" && item.source === "url"
        ? (remaining[nextBinary++] ?? item)
        : item,
    );
  }
  if (htmlImageCount > 1) return combined;
  return [...remaining, ...combined];
};

const normalizeUriList = (value: string) => {
  const seen = new Set<string>();
  const items: CardCanvasClipboardItem[] = [];
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const url = normalizeCardWebLink(trimmed);
    if (!url || seen.has(url)) continue;
    if (items.length >= MAX_CARD_CANVAS_CLIPBOARD_LINKS) {
      throw new CardCanvasClipboardLimitError("CLIPBOARD_LINK_LIMIT_REACHED");
    }
    seen.add(url);
    items.push({ type: "link", url });
  }
  return items;
};

const assertResultLimits = (items: readonly CardCanvasClipboardItem[]) => {
  const images = items.filter((item) => item.type === "image").length;
  const links = items.filter((item) => item.type === "link").length;
  if (items.length > MAX_CARD_CANVAS_CLIPBOARD_OBJECTS) {
    throw new CardCanvasClipboardLimitError("CLIPBOARD_OBJECT_LIMIT_REACHED");
  }
  if (images > MAX_CARD_CANVAS_CLIPBOARD_IMAGES) {
    throw new CardCanvasClipboardLimitError("CLIPBOARD_IMAGE_LIMIT_REACHED");
  }
  if (links > MAX_CARD_CANVAS_CLIPBOARD_LINKS) {
    throw new CardCanvasClipboardLimitError("CLIPBOARD_LINK_LIMIT_REACHED");
  }
  return { objects: items.length, images, links };
};

export const normalizeCardCanvasClipboard = (
  input: CardCanvasClipboardInput,
): CardCanvasClipboardResult => {
  if ((input.images?.length ?? 0) > MAX_CARD_CANVAS_CLIPBOARD_IMAGES) {
    throw new CardCanvasClipboardLimitError("CLIPBOARD_IMAGE_LIMIT_REACHED");
  }
  (input.images ?? []).reduce(
    (totalBytes, image) => addClipboardImageBytes(totalBytes, image.file.size),
    0,
  );
  assertClipboardTextSize([input.text, input.html, input.uriList]);
  const binaryImages = normalizeBinaryImages(input.images ?? []);
  let contentItems: CardCanvasClipboardItem[] = [];
  if (input.html !== undefined) {
    contentItems = parseCardCanvasClipboardHtml(input.html);
  } else if (input.uriList) {
    contentItems = normalizeUriList(input.uriList);
  } else if (input.text) {
    const text = cleanClipboardText(input.text);
    const url = normalizeCardWebLink(text);
    contentItems = text
      ? url
        ? [{ type: "link", url }]
        : [{ type: "text", text }]
      : [];
  }
  const items = combineImagesWithHtml(binaryImages, contentItems);
  return { items, counts: assertResultLimits(items) };
};

export const getCardCanvasClipboardInputFromDataTransfer = (
  dataTransfer: Pick<DataTransfer, "files" | "getData" | "types">,
): CardCanvasClipboardInput => {
  const images: CardCanvasClipboardImageInput[] = [];
  let imageBytes = 0;
  for (const file of dataTransfer.files) {
    if (!file.type.startsWith("image/")) continue;
    if (images.length >= MAX_CARD_CANVAS_CLIPBOARD_IMAGES) {
      throw new CardCanvasClipboardLimitError("CLIPBOARD_IMAGE_LIMIT_REACHED");
    }
    imageBytes = addClipboardImageBytes(imageBytes, file.size);
    images.push({ file });
  }
  const formats = Array.from(dataTransfer.types);
  const textType = ["text/html", "text/uri-list", "text/plain"].find((type) =>
    formats.includes(type),
  );
  const textValue = textType ? dataTransfer.getData(textType) : "";
  return {
    ...(textType === "text/plain" && textValue ? { text: textValue } : {}),
    ...(textType === "text/html" && textValue ? { html: textValue } : {}),
    ...(textType === "text/uri-list" && textValue
      ? { uriList: textValue }
      : {}),
    images,
    formats,
  };
};

type ClipboardItemReader = Pick<ClipboardItem, "getType" | "types">;

const IMAGE_TYPE_ORDER = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export const readCardCanvasClipboardItems = async (
  clipboardItems: readonly ClipboardItemReader[],
): Promise<CardCanvasClipboardInput> => {
  const imageTypes: { item: ClipboardItemReader; type: string }[] = [];
  for (const item of clipboardItems) {
    const available = new Set(item.types);
    const preferred = IMAGE_TYPE_ORDER.find((type) => available.has(type));
    const fallback = item.types.find((type) => type.startsWith("image/"));
    const type = preferred ?? fallback;
    if (!type) continue;
    if (imageTypes.length >= MAX_CARD_CANVAS_CLIPBOARD_IMAGES) {
      throw new CardCanvasClipboardLimitError("CLIPBOARD_IMAGE_LIMIT_REACHED");
    }
    imageTypes.push({ item, type });
  }
  const textTypes = ["text/html", "text/uri-list", "text/plain"] as const;
  const textType = textTypes.find((type) =>
    clipboardItems.some((item) => item.types.includes(type)),
  );
  let textValue: string | undefined;
  if (textType) {
    const textItem = clipboardItems.find((item) =>
      item.types.includes(textType),
    );
    const textBlob = await textItem?.getType(textType);
    if (textBlob && textBlob.size > MAX_CARD_CANVAS_CLIPBOARD_BYTES) {
      throw new CardCanvasClipboardLimitError("CLIPBOARD_CONTENT_TOO_LARGE");
    }
    textValue = await textBlob?.text();
  }
  const images: CardCanvasClipboardImageInput[] = [];
  let imageBytes = 0;
  for (const { item, type } of imageTypes) {
    const blob = await item.getType(type);
    imageBytes = addClipboardImageBytes(imageBytes, blob.size);
    const extension = type.split("/", 2)[1]?.replace("jpeg", "jpg") ?? "img";
    images.push({
      file: new File(
        [blob],
        `clipboard-image-${images.length + 1}.${extension}`,
        {
          type: blob.type || type,
        },
      ),
    });
  }
  return {
    ...(textType === "text/plain" && textValue ? { text: textValue } : {}),
    ...(textType === "text/html" && textValue ? { html: textValue } : {}),
    ...(textType === "text/uri-list" && textValue
      ? { uriList: textValue }
      : {}),
    images,
    formats: Array.from(
      new Set(clipboardItems.flatMap((item) => Array.from(item.types))),
    ),
  };
};
