export const VISUAL_WALL_LOGICAL_WIDTH = 1_200;
export const VISUAL_WALL_MIN_HEIGHT = 680;
export const VISUAL_WALL_BOTTOM_PADDING = 160;
export const VISUAL_WALL_MIN_ITEM_WIDTH = 120;
export const VISUAL_WALL_MIN_ITEM_HEIGHT = 44;
export const VISUAL_WALL_MAX_LOGICAL_HEIGHT = 1_000_000;

export interface VisualWallRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const getVisualWallImageDimensions = (
  item: Pick<VisualWallRect, "width" | "height"> & {
    widthPx?: number | null;
    heightPx?: number | null;
  },
) => {
  const width = item.widthPx ?? 0;
  const height = item.heightPx ?? 0;
  const hasNaturalDimensions =
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0;
  return {
    width: Math.max(1, Math.round(hasNaturalDimensions ? width : item.width)),
    height: Math.max(
      1,
      Math.round(hasNaturalDimensions ? height : item.height),
    ),
  };
};

const finiteOr = (value: number, fallback: number) =>
  Number.isFinite(value) ? value : fallback;

const positiveOr = (value: number, fallback: number) =>
  Number.isFinite(value) && value > 0 ? value : fallback;

export const clampVisualWallRect = (
  rect: VisualWallRect,
  logicalWidth = VISUAL_WALL_LOGICAL_WIDTH,
): VisualWallRect => {
  const width = positiveOr(rect.width, 320);
  const height = positiveOr(rect.height, 240);
  const ratio = positiveOr(width / height, 4 / 3);
  const maxWidth = Math.max(
    VISUAL_WALL_MIN_ITEM_HEIGHT,
    Math.min(logicalWidth, VISUAL_WALL_MAX_LOGICAL_HEIGHT * ratio),
  );
  const minWidth = Math.min(
    maxWidth,
    Math.max(VISUAL_WALL_MIN_ITEM_WIDTH, VISUAL_WALL_MIN_ITEM_HEIGHT * ratio),
  );
  const safeWidth = Math.min(maxWidth, Math.max(minWidth, width));
  const safeHeight = Math.min(
    VISUAL_WALL_MAX_LOGICAL_HEIGHT,
    Math.max(VISUAL_WALL_MIN_ITEM_HEIGHT, safeWidth / ratio),
  );
  return {
    x: Math.min(logicalWidth - safeWidth, Math.max(0, finiteOr(rect.x, 0))),
    y: Math.min(
      VISUAL_WALL_MAX_LOGICAL_HEIGHT - safeHeight,
      Math.max(0, finiteOr(rect.y, 0)),
    ),
    width: safeWidth,
    height: safeHeight,
  };
};

export const resizeVisualWallRect = (
  rect: VisualWallRect,
  deltaX: number,
  deltaY: number,
): VisualWallRect => {
  const bounded = clampVisualWallRect(rect);
  const ratio = bounded.width / bounded.height;
  const projectedWidthDelta = (deltaX + deltaY / ratio) / (1 + 1 / ratio ** 2);
  const width = Math.max(1, bounded.width + projectedWidthDelta);
  return clampVisualWallRect({
    ...bounded,
    width,
    height: width / ratio,
  });
};

export const getVisualWallLogicalHeight = (
  items: readonly Pick<VisualWallRect, "y" | "height">[],
) =>
  items.reduce(
    (height, item) =>
      Math.max(height, item.y + item.height + VISUAL_WALL_BOTTOM_PADDING),
    VISUAL_WALL_MIN_HEIGHT,
  );

export const getVisualWallScale = (renderedWidth: number) =>
  Math.max(0.01, renderedWidth / VISUAL_WALL_LOGICAL_WIDTH);

export const normalizeVisualWallRect = (
  rect: VisualWallRect,
): VisualWallRect => {
  const clamped = clampVisualWallRect(rect);
  const width = Math.round(clamped.width);
  const height = Math.max(
    VISUAL_WALL_MIN_ITEM_HEIGHT,
    Math.min(VISUAL_WALL_MAX_LOGICAL_HEIGHT, Math.round(clamped.height)),
  );
  return {
    x: Math.min(
      VISUAL_WALL_LOGICAL_WIDTH - width,
      Math.max(0, Math.round(clamped.x)),
    ),
    y: Math.min(
      VISUAL_WALL_MAX_LOGICAL_HEIGHT - height,
      Math.max(0, Math.round(clamped.y)),
    ),
    width,
    height,
  };
};

export const placeVisualWallImages = (
  existing: readonly Pick<VisualWallRect, "x" | "y" | "width" | "height">[],
  images: readonly { width: number; height: number }[],
) => {
  const gap = 24;
  const displayWidth = 320;
  let x = gap;
  let y =
    existing.length === 0
      ? gap
      : existing.reduce(
          (bottom, item) => Math.max(bottom, item.y + item.height),
          0,
        ) +
        gap * 2;
  let rowHeight = 0;

  return images.map((image) => {
    const ratio = positiveOr(image.width, 320) / positiveOr(image.height, 240);
    const size = clampVisualWallRect({
      x: 0,
      y: 0,
      width: displayWidth,
      height: displayWidth / ratio,
    });
    if (x > gap && x + size.width > VISUAL_WALL_LOGICAL_WIDTH - gap) {
      x = gap;
      y += rowHeight + gap;
      rowHeight = 0;
    }
    const rect = normalizeVisualWallRect({ ...size, x, y });
    x += rect.width + gap;
    rowHeight = Math.max(rowHeight, rect.height);
    return rect;
  });
};

export const isFreeformShareUrl = (value: string) => {
  try {
    if (!value.startsWith("https://www.icloud.com/freeform/")) {
      return false;
    }
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "www.icloud.com" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      /^\/freeform\/[A-Za-z0-9_-]{10,128}\/?$/.test(url.pathname)
    );
  } catch {
    return false;
  }
};
