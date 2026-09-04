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

const finiteOr = (value: number, fallback: number) =>
  Number.isFinite(value) ? value : fallback;

export const clampVisualWallRect = (
  rect: VisualWallRect,
  logicalWidth = VISUAL_WALL_LOGICAL_WIDTH,
): VisualWallRect => {
  const safeWidth = Math.min(
    logicalWidth,
    Math.max(VISUAL_WALL_MIN_ITEM_WIDTH, finiteOr(rect.width, 320)),
  );
  const ratio = Math.max(
    0.01,
    finiteOr(rect.width, 320) / Math.max(1, finiteOr(rect.height, 240)),
  );
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
  const ratio = rect.width / Math.max(1, rect.height);
  const projectedWidthDelta = (deltaX + deltaY / ratio) / (1 + 1 / ratio ** 2);
  return clampVisualWallRect({
    ...rect,
    width: rect.width + projectedWidthDelta,
    height: (rect.width + projectedWidthDelta) / ratio,
  });
};

export const getVisualWallLogicalHeight = (
  items: readonly Pick<VisualWallRect, "y" | "height">[],
) =>
  Math.max(
    VISUAL_WALL_MIN_HEIGHT,
    ...items.map((item) => item.y + item.height + VISUAL_WALL_BOTTOM_PADDING),
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
      : Math.max(...existing.map((item) => item.y + item.height)) + gap * 2;
  let rowHeight = 0;

  return images.map((image) => {
    const ratio = Math.max(0.01, image.width / Math.max(1, image.height));
    const rect = clampVisualWallRect({
      x,
      y,
      width: displayWidth,
      height: displayWidth / ratio,
    });
    if (x > gap && x + rect.width > VISUAL_WALL_LOGICAL_WIDTH - gap) {
      x = gap;
      y += rowHeight + gap;
      rowHeight = 0;
      rect.x = x;
      rect.y = y;
    }
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
