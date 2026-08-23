type CanvasJson =
  | null
  | boolean
  | number
  | string
  | CanvasJson[]
  | { [key: string]: CanvasJson };

const MAX_COORDINATE = 1_000_000;
const MAX_INTEGER = 2_147_483_647;
const MAX_TIMESTAMP = 32_503_680_000_000;
const MAX_POINTS = 100_000;

interface NumberRule {
  min: number;
  max: number;
  integer?: boolean;
  allowed?: ReadonlySet<number>;
}

const NUMBER_RULES: Record<string, NumberRule> = {
  x: { min: -MAX_COORDINATE, max: MAX_COORDINATE },
  y: { min: -MAX_COORDINATE, max: MAX_COORDINATE },
  width: { min: 0, max: MAX_COORDINATE },
  height: { min: 0, max: MAX_COORDINATE },
  angle: { min: -2 * Math.PI, max: 2 * Math.PI },
  strokeWidth: { min: 0, max: 100 },
  roughness: { min: 0, max: 10 },
  opacity: { min: 0, max: 100 },
  seed: { min: 0, max: MAX_INTEGER, integer: true },
  version: { min: 1, max: MAX_INTEGER, integer: true },
  versionNonce: { min: 0, max: MAX_INTEGER, integer: true },
  updated: { min: 0, max: MAX_TIMESTAMP, integer: true },
  fontSize: { min: 1, max: 512 },
  fontFamily: {
    min: 1,
    max: 9,
    integer: true,
    allowed: new Set([1, 2, 3, 5, 6, 7, 8, 9]),
  },
  lineHeight: { min: 0.1, max: 10 },
  baseline: { min: 0, max: MAX_COORDINATE },
};
const BOOLEAN_KEYS = new Set([
  "locked",
  "elbowed",
  "autoResize",
  "simulatePressure",
]);
const ARROWHEADS = new Set([
  "arrow",
  "bar",
  "dot",
  "circle",
  "circle_outline",
  "triangle",
  "triangle_outline",
  "diamond",
  "diamond_outline",
  "crowfoot_one",
  "crowfoot_many",
  "crowfoot_one_or_many",
]);
const ENUMS: Record<string, string[]> = {
  fillStyle: ["hachure", "cross-hatch", "solid", "zigzag"],
  strokeStyle: ["solid", "dashed", "dotted"],
  strokeSharpness: ["round", "sharp"],
  textAlign: ["left", "center", "right"],
  verticalAlign: ["top", "middle", "bottom"],
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function createElementFieldSanitizer(invalid: () => never) {
  const finiteNumber = (
    value: unknown,
    min = -MAX_COORDINATE,
    max = MAX_COORDINATE,
    integer = false,
  ) => {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (integer && !Number.isInteger(value))
    ) {
      invalid();
    }
    return value;
  };
  const stringValue = (value: unknown, max = Number.POSITIVE_INFINITY) => {
    if (typeof value !== "string" || value.length > max) invalid();
    return value;
  };
  const nullableString = (value: unknown, max = 255) =>
    value === null ? null : stringValue(value, max);
  const limitedArray = (value: unknown, max: number): unknown[] => {
    if (!Array.isArray(value) || value.length > max) invalid();
    return value as unknown[];
  };
  const numberPair = (
    value: unknown,
    min = -MAX_COORDINATE,
    max = MAX_COORDINATE,
  ): [number, number] => {
    if (!Array.isArray(value) || value.length !== 2) invalid();
    return [finiteNumber(value[0], min, max), finiteNumber(value[1], min, max)];
  };
  const exactKeys = (value: Record<string, unknown>, allowed: string[]) => {
    if (Object.keys(value).some((key) => !allowed.includes(key))) invalid();
  };
  const requireType = (type: string, allowed: string[]) => {
    if (!allowed.includes(type)) invalid();
  };
  const sanitizeBinding = (value: unknown): CanvasJson => {
    if (value === null) return null;
    if (!isRecord(value)) invalid();
    exactKeys(value, ["elementId", "focus", "gap", "fixedPoint"]);
    const binding: Record<string, CanvasJson> = {
      elementId: stringValue(value.elementId, 255),
      focus: finiteNumber(value.focus, -1, 1),
      gap: finiteNumber(value.gap, 0, MAX_COORDINATE),
    };
    if (value.fixedPoint !== undefined) {
      binding.fixedPoint = numberPair(value.fixedPoint, -1, 2);
    }
    return binding;
  };
  const sanitizeBoundElements = (value: unknown): CanvasJson => {
    if (value === null) return null;
    return limitedArray(value, 5000).map((item) => {
      if (!isRecord(item)) invalid();
      exactKeys(item, ["id", "type"]);
      const type = stringValue(item.type);
      if (type !== "arrow" && type !== "text") invalid();
      return { id: stringValue(item.id, 255), type };
    });
  };
  const sanitizeRoundness = (value: unknown): CanvasJson => {
    if (value === null) return null;
    if (!isRecord(value)) invalid();
    exactKeys(value, ["type", "value"]);
    const type = finiteNumber(value.type, 1, 3, true);
    if (type !== 1 && type !== 2 && type !== 3) invalid();
    return value.value === undefined
      ? { type }
      : { type, value: finiteNumber(value.value, 0, MAX_COORDINATE) };
  };
  const sanitizeCrop = (value: unknown): CanvasJson => {
    if (value === null) return null;
    if (!isRecord(value)) invalid();
    const keys = ["x", "y", "width", "height", "naturalWidth", "naturalHeight"];
    exactKeys(value, keys);
    if (keys.some((key) => value[key] === undefined)) invalid();
    const crop = Object.fromEntries(
      keys.map((key) => [key, finiteNumber(value[key], 0, MAX_COORDINATE)]),
    );
    if (crop.naturalWidth === 0 || crop.naturalHeight === 0) invalid();
    return crop;
  };

  return (key: string, value: unknown, type: string): CanvasJson => {
    const numberRule = NUMBER_RULES[key];
    if (numberRule) {
      if (["fontSize", "fontFamily", "lineHeight", "baseline"].includes(key)) {
        requireType(type, ["text"]);
      }
      const number = finiteNumber(
        value,
        numberRule.min,
        numberRule.max,
        numberRule.integer,
      );
      if (numberRule.allowed && !numberRule.allowed.has(number)) invalid();
      return number;
    }
    if (BOOLEAN_KEYS.has(key)) {
      if (key === "elbowed") requireType(type, ["arrow"]);
      if (key === "autoResize") requireType(type, ["text"]);
      if (key === "simulatePressure") requireType(type, ["freedraw"]);
      if (typeof value !== "boolean") invalid();
      return value;
    }
    if (key === "groupIds") {
      return limitedArray(value, 100).map((item) => stringValue(item, 255));
    }
    if (key === "points" || key === "lastCommittedPoint") {
      requireType(type, ["line", "arrow", "freedraw"]);
      if (key === "lastCommittedPoint" && value === null) return null;
      if (key === "lastCommittedPoint") return numberPair(value);
      return limitedArray(value, MAX_POINTS).map((item) => numberPair(item));
    }
    if (key === "pressures") {
      requireType(type, ["freedraw"]);
      return limitedArray(value, MAX_POINTS).map((item) =>
        finiteNumber(item, 0, 1),
      );
    }
    if (key === "scale") {
      requireType(type, ["image"]);
      const scale = numberPair(value);
      if (scale.some((item) => item !== -1 && item !== 1)) invalid();
      return scale;
    }
    if (key === "boundElements") return sanitizeBoundElements(value);
    if (key === "startBinding" || key === "endBinding") {
      requireType(type, ["line", "arrow"]);
      return sanitizeBinding(value);
    }
    if (key === "roundness") return sanitizeRoundness(value);
    if (key === "crop") {
      requireType(type, ["image"]);
      return sanitizeCrop(value);
    }
    if (key === "fixedSegments") {
      requireType(type, ["arrow"]);
      if (value === null) return null;
      return limitedArray(value, MAX_POINTS).map((item) => {
        if (!isRecord(item)) invalid();
        exactKeys(item, ["start", "end", "index"]);
        return {
          start: numberPair(item.start),
          end: numberPair(item.end),
          index: finiteNumber(item.index, 0, MAX_POINTS, true),
        };
      });
    }
    if (key === "startIsSpecial" || key === "endIsSpecial") {
      requireType(type, ["arrow"]);
      if (value !== null && typeof value !== "boolean") invalid();
      return value;
    }
    if (key === "frameId" || key === "index" || key === "containerId") {
      if (key === "containerId") requireType(type, ["text"]);
      return nullableString(value);
    }
    if (key === "startArrowhead" || key === "endArrowhead") {
      requireType(type, ["line", "arrow"]);
      if (value === null) return null;
      const arrowhead = stringValue(value);
      if (!ARROWHEADS.has(arrowhead)) invalid();
      return arrowhead;
    }
    if (key === "fileId") {
      requireType(type, ["image"]);
      if (value === null) return null;
      const fileId = stringValue(value, 255);
      if (!/^[A-Za-z0-9_-]+$/.test(fileId)) invalid();
      return fileId;
    }
    if (key === "status") {
      requireType(type, ["image"]);
      const status = stringValue(value);
      if (!["pending", "saved", "error"].includes(status)) invalid();
      return status;
    }
    if (["text", "originalText", "rawText"].includes(key)) {
      requireType(type, ["text"]);
      return stringValue(value);
    }
    if (key === "name") {
      requireType(type, ["frame"]);
      return nullableString(value);
    }
    if (key === "textAlign" || key === "verticalAlign") {
      requireType(type, ["text"]);
    }
    const item = stringValue(
      value,
      ["strokeColor", "backgroundColor"].includes(key) ? 64 : 32,
    );
    if (ENUMS[key] && !ENUMS[key].includes(item)) invalid();
    return item;
  };
}
