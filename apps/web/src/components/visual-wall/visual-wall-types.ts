export interface VisualWallItem {
  publicId: string;
  resourcePublicId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  widthPx?: number | null;
  heightPx?: number | null;
  zIndex: number;
  title: string;
  viewUrl: string;
}

export type VisualWallItemPatch = Pick<
  VisualWallItem,
  "x" | "y" | "width" | "height" | "zIndex"
>;

export interface VisualWallProps {
  items: readonly VisualWallItem[];
  canEdit: boolean;
  freeformUrl: string | null;
  isBusy?: boolean;
  label: string;
  emptyMessage?: string;
  onFiles: (files: File[]) => void | Promise<void>;
  onUpdate: (
    publicId: string,
    patch: VisualWallItemPatch,
  ) => void | Promise<void>;
  onRemove: (publicId: string) => void | Promise<void>;
  onSetFreeformUrl: (url: string | null) => void | Promise<void>;
  onAddFromResources?: () => void;
}
