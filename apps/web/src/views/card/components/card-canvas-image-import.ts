import {
  MAX_CARD_CANVAS_ELEMENTS,
  MAX_CARD_CANVAS_IMAGE_BYTES,
} from "@kan/shared";

const IMAGE_EXTENSION_BY_TYPE: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const getCardCanvasImageFiles = (
  files: ArrayLike<File> | Iterable<File>,
) => Array.from(files).filter((file) => file.type.startsWith("image/"));

export const hasCardCanvasImageDragItem = (
  dataTransfer: Pick<DataTransfer, "files" | "items">,
) =>
  getCardCanvasImageFiles(dataTransfer.files).length > 0 ||
  Array.from(dataTransfer.items).some(
    (item) => item.kind === "file" && item.type.startsWith("image/"),
  );

export const createCardCanvasImageImportQueue = () => {
  let tail = Promise.resolve();

  return <T>(task: () => Promise<T>) => {
    const result = tail.then(task);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
};

export const getCardCanvasNativePasteAction = ({
  currentElementCount,
  elements,
  files,
}: {
  currentElementCount: number;
  elements: readonly { type: string }[] | undefined;
  files: Record<string, unknown> | undefined;
}) => {
  if (
    elements &&
    currentElementCount + elements.length > MAX_CARD_CANVAS_ELEMENTS
  ) {
    return "block" as const;
  }
  return (files && Object.keys(files).length > 0) ||
    elements?.some((element) => element.type === "image")
    ? ("image" as const)
    : ("continue" as const);
};

export const downloadCardCanvasImageUrl = async (
  value: string,
  fetchImage: typeof fetch = fetch,
) => {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  ) {
    throw new Error("UNSAFE_IMAGE_URL");
  }

  const response = await fetchImage(url.toString(), {
    mode: "cors",
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) throw new Error("IMAGE_DOWNLOAD_FAILED");

  const contentLengthValue = response.headers.get("content-length");
  if (contentLengthValue !== null) {
    const contentLength = Number(contentLengthValue);
    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_CARD_CANVAS_IMAGE_BYTES
    ) {
      await response.body?.cancel();
      throw new Error("IMAGE_RESOURCE_TOO_LARGE");
    }
  }

  const contentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (!contentType?.startsWith("image/")) {
    await response.body?.cancel();
    throw new Error("NOT_AN_IMAGE");
  }
  if (!response.body) throw new Error("IMAGE_DOWNLOAD_FAILED");

  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_CARD_CANVAS_IMAGE_BYTES) {
        await reader.cancel();
        throw new Error("IMAGE_RESOURCE_TOO_LARGE");
      }
      chunks.push(
        chunk.buffer.slice(
          chunk.byteOffset,
          chunk.byteOffset + chunk.byteLength,
        ),
      );
    }
  } finally {
    reader.releaseLock();
  }

  const blob = new Blob(chunks, { type: contentType });
  const extension = IMAGE_EXTENSION_BY_TYPE[contentType] ?? "img";
  return new File([blob], `imagen-pizarra.${extension}`, {
    type: contentType,
  });
};
