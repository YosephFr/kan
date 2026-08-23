type CanvasJson =
  | null
  | boolean
  | number
  | string
  | CanvasJson[]
  | { [key: string]: CanvasJson };

const createBaseElementDefaults = (): Record<string, CanvasJson> => ({
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
  groupIds: [],
  frameId: null,
  index: null,
  roundness: null,
  seed: 1,
  version: 1,
  versionNonce: 0,
  isDeleted: false,
  boundElements: null,
  updated: 1,
  link: null,
  locked: false,
});

const createLinearDefaults = (): Record<string, CanvasJson> => ({
  points: [],
  lastCommittedPoint: null,
  startBinding: null,
  endBinding: null,
  startArrowhead: null,
  endArrowhead: null,
});

export function createElementDefaults(type: string) {
  const base = createBaseElementDefaults();
  if (type === "line") return { ...base, ...createLinearDefaults() };
  if (type === "arrow") {
    return {
      ...base,
      ...createLinearDefaults(),
      elbowed: false,
      fixedSegments: null,
      startIsSpecial: false,
      endIsSpecial: false,
    };
  }
  if (type === "freedraw") {
    return {
      ...base,
      points: [],
      pressures: [],
      simulatePressure: true,
      lastCommittedPoint: null,
    };
  }
  if (type === "text") {
    return {
      ...base,
      fontSize: 20,
      fontFamily: 5,
      text: "",
      textAlign: "left",
      verticalAlign: "top",
      containerId: null,
      originalText: "",
      autoResize: true,
      lineHeight: 1.25,
    };
  }
  if (type === "image") {
    return {
      ...base,
      strokeColor: "transparent",
      fileId: null,
      status: "saved",
      scale: [1, 1],
      crop: null,
    };
  }
  if (type === "frame") return { ...base, name: "Zona sin título" };
  return base;
}
