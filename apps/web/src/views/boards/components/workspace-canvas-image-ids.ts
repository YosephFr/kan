import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

export const getWorkspaceCanvasImagePublicIds = (
  elements: readonly Pick<
    ExcalidrawElement,
    "customData" | "isDeleted" | "type"
  >[],
) =>
  new Set(
    elements.flatMap((element) => {
      if (
        element.type !== "image" ||
        element.isDeleted ||
        !element.customData ||
        typeof element.customData !== "object"
      ) {
        return [];
      }
      const publicId = (element.customData as Record<string, unknown>)
        .kanResourcePublicId;
      return typeof publicId === "string" && /^[a-z0-9]{12}$/.test(publicId)
        ? [publicId]
        : [];
    }),
  );
