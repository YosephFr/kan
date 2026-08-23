import {
  extractCardCanvasReferences,
  normalizeCardCanvasScene,
} from "@kan/shared";

export const isCardResourceUsedOnCanvas = (
  scene: unknown,
  resourcePublicId: string,
) => {
  if (scene === null) return false;
  const normalizedScene = normalizeCardCanvasScene(scene);
  return extractCardCanvasReferences(normalizedScene).resources.some(
    (reference) => reference.publicId === resourcePublicId,
  );
};
