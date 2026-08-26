import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

const FORBIDDEN_TOOLS = new Set(["image", "embeddable", "frame", "magicframe"]);
const FORBIDDEN_ELEMENT_TYPES = new Set(["embeddable", "frame", "magicframe"]);

export const isWorkspaceCanvasToolForbidden = (type: string) =>
  FORBIDDEN_TOOLS.has(type);

export const sanitizeWorkspaceCanvasElements = (
  elements: readonly ExcalidrawElement[],
) => {
  const removedContainerIds = new Set(
    elements.flatMap((element) =>
      FORBIDDEN_ELEMENT_TYPES.has(element.type) ? [element.id] : [],
    ),
  );
  const sanitized = elements.flatMap((element) => {
    if (removedContainerIds.has(element.id)) return [];
    const frameRemoved =
      element.frameId !== null && removedContainerIds.has(element.frameId);
    return element.link || frameRemoved
      ? [
          {
            ...element,
            ...(element.link ? { link: null } : {}),
            ...(frameRemoved ? { frameId: null } : {}),
          } as ExcalidrawElement,
        ]
      : [element];
  });
  return {
    elements: sanitized,
    changed:
      sanitized.length !== elements.length ||
      sanitized.some((element, index) => element !== elements[index]),
  };
};
