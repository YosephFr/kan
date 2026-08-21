export interface AttachmentByteRange {
  end: number;
  header: string;
  length: number;
  start: number;
}

export function parseAttachmentRange(
  value: string | undefined,
  size: number,
): AttachmentByteRange | null | "invalid" {
  if (!value) return null;
  if (!Number.isSafeInteger(size) || size <= 0 || value.includes(",")) {
    return "invalid";
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) return "invalid";

  const [, rawStart = "", rawEnd = ""] = match;
  if (!rawStart && !rawEnd) return "invalid";

  let start: number;
  let end: number;
  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return "invalid";
    }
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Math.min(Number(rawEnd), size - 1) : size - 1;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      start >= size ||
      end < start
    ) {
      return "invalid";
    }
  }

  return {
    start,
    end,
    length: end - start + 1,
    header: `bytes=${start}-${end}`,
  };
}
