import type {
  ExcalidrawElement,
  FileId,
  NonDeleted,
} from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import {
  convertToExcalidrawElements,
  exportToBlob,
  exportToSvg,
  serializeAsJSON,
} from "@excalidraw/excalidraw";

import type { CardCanvasElement } from "./card-canvas-types";
import {
  getCanvasElementNumber,
  getCanvasElementString,
  parseCanvasInternalLink,
} from "./card-canvas-elements";

export type CardCanvasExportFormat = "png" | "svg" | "excalidraw";

interface CardCanvasExportOptions {
  api: ExcalidrawImperativeAPI;
  files?: BinaryFiles;
  title: string;
  format: CardCanvasExportFormat;
  elementIds?: string[];
  maxImageDimension?: number;
  resourceTitles: ReadonlyMap<string, string>;
  subtaskTitles: ReadonlyMap<string, string>;
}

interface ExcalidrawExportOptions {
  elements: readonly NonDeleted<ExcalidrawElement>[];
  appState: Partial<AppState>;
  files: BinaryFiles;
  exportPadding: number;
  renderEmbeddables?: boolean;
  mimeType?: string;
  maxWidthOrHeight?: number;
}

const exportSceneToSvg = exportToSvg as unknown as (
  options: ExcalidrawExportOptions,
) => Promise<SVGSVGElement>;
const exportSceneToBlob = exportToBlob as unknown as (
  options: ExcalidrawExportOptions,
) => Promise<Blob>;

const safeFileName = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80) || "pizarra";

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

const getExportLabel = (
  element: CardCanvasElement,
  resourceTitles: ReadonlyMap<string, string>,
  subtaskTitles: ReadonlyMap<string, string>,
) => {
  const link = parseCanvasInternalLink(element);
  if (!link) return "Elemento de Kan";
  if (link.kind === "resource") {
    return resourceTitles.get(link.publicId) ?? "Recurso de la tarjeta";
  }
  return subtaskTitles.get(link.publicId) ?? "Subtarea de la tarjeta";
};

const replaceEmbeddableCards = (
  source: readonly ExcalidrawElement[],
  resourceTitles: ReadonlyMap<string, string>,
  subtaskTitles: ReadonlyMap<string, string>,
) => {
  const result: ExcalidrawElement[] = [];
  for (const element of source) {
    if (element.type !== "embeddable") {
      result.push(element);
      continue;
    }
    const canvasElement = element as unknown as CardCanvasElement;
    const id = getCanvasElementString(canvasElement, "id") ?? "card";
    const replacement = convertToExcalidrawElements(
      [
        {
          type: "rectangle",
          id: `export-${id}`,
          x: getCanvasElementNumber(canvasElement, "x") ?? 0,
          y: getCanvasElementNumber(canvasElement, "y") ?? 0,
          width: Math.max(
            getCanvasElementNumber(canvasElement, "width") ?? 260,
            180,
          ),
          height: Math.max(
            getCanvasElementNumber(canvasElement, "height") ?? 96,
            72,
          ),
          frameId: getCanvasElementString(canvasElement, "frameId"),
          backgroundColor: "#f8f9fa",
          strokeColor: "#495057",
          fillStyle: "solid",
          roughness: 0,
          roundness: { type: 3 },
          label: {
            text: getExportLabel(canvasElement, resourceTitles, subtaskTitles),
            fontSize: 18,
          },
        },
      ],
      { regenerateIds: false },
    ) as unknown as ExcalidrawElement[];
    result.push(...replacement);
  }
  return result;
};

const getExportElements = ({
  api,
  elementIds,
  resourceTitles,
  subtaskTitles,
}: Pick<
  CardCanvasExportOptions,
  "api" | "elementIds" | "resourceTitles" | "subtaskTitles"
>) => {
  const selectedIds = elementIds ? new Set(elementIds) : null;
  const elements = api
    .getSceneElements()
    .filter(
      (element) =>
        !element.isDeleted && (!selectedIds || selectedIds.has(element.id)),
    );
  return replaceEmbeddableCards(elements, resourceTitles, subtaskTitles).filter(
    (element) => !element.isDeleted,
  ) as NonDeleted<ExcalidrawElement>[];
};

const getExportFiles = (
  elements: readonly NonDeleted<ExcalidrawElement>[],
  files: BinaryFiles,
) => {
  const fileIds = new Set(
    elements.flatMap((element) =>
      element.type === "image" && element.fileId ? [element.fileId] : [],
    ),
  );
  return Object.fromEntries(
    Object.entries(files).filter(([fileId]) => fileIds.has(fileId as FileId)),
  ) as BinaryFiles;
};

export const exportCardCanvas = async (options: CardCanvasExportOptions) => {
  const elements = getExportElements(options);
  if (elements.length === 0) throw new Error("EMPTY_EXPORT");
  const appState = options.api.getAppState();
  const files = getExportFiles(
    elements,
    options.files ?? options.api.getFiles(),
  );
  const filename = safeFileName(options.title);

  if (options.format === "excalidraw") {
    const serialized = serializeAsJSON(elements, appState, files, "local");
    downloadBlob(
      new Blob([serialized], { type: "application/json" }),
      `${filename}.excalidraw`,
    );
    return;
  }

  const exportAppState: Partial<AppState> = {
    ...appState,
    exportBackground: true,
    exportWithDarkMode: appState.theme === "dark",
  };
  if (options.format === "svg") {
    const svg = await exportSceneToSvg({
      elements,
      appState: exportAppState,
      files,
      exportPadding: 24,
      renderEmbeddables: false,
    });
    downloadBlob(
      new Blob([svg.outerHTML], { type: "image/svg+xml" }),
      `${filename}.svg`,
    );
    return;
  }

  const blob = await exportSceneToBlob({
    elements,
    appState: exportAppState,
    files,
    mimeType: "image/png",
    exportPadding: 24,
    maxWidthOrHeight: options.maxImageDimension,
  });
  downloadBlob(blob, `${filename}.png`);
};
