import type { VisualWallItem } from "~/components/visual-wall/VisualWall";

export const toWorkspaceVisualWallItems = (
  items: readonly {
    publicId: string;
    imagePublicId: string;
    title: string;
    viewUrl: string;
    x: number;
    y: number;
    width: number;
    height: number;
    widthPx?: number | null;
    heightPx?: number | null;
    zIndex: number;
  }[],
): VisualWallItem[] =>
  items.map((item) => ({
    publicId: item.publicId,
    resourcePublicId: item.imagePublicId,
    title: item.title,
    viewUrl: item.viewUrl,
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
    widthPx: item.widthPx,
    heightPx: item.heightPx,
    zIndex: item.zIndex,
  }));
