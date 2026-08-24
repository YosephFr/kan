import { t } from "@lingui/core/macro";

import type { CardCanvasFrameView } from "./card-canvas-types";
import type { CardResource } from "./card-resource-types";
import { parseCanvasInternalLink } from "./card-canvas-elements";
import { CardCanvasWebResourceCard } from "./CardCanvasWebResourceCard";

interface CardCanvasEmbeddableProps {
  element: { link: string | null };
  resources: Map<string, CardResource>;
  subtasks: Map<string, NonNullable<CardCanvasFrameView["subtask"]>>;
  onOpenResource: (resourcePublicId: string) => void;
  onOpenSubtask: (subtaskPublicId: string) => void;
}

export function CardCanvasEmbeddable({
  element,
  resources,
  subtasks,
  onOpenResource,
  onOpenSubtask,
}: CardCanvasEmbeddableProps) {
  const link = parseCanvasInternalLink(
    element as unknown as Parameters<typeof parseCanvasInternalLink>[0],
  );
  if (!link) return null;
  const resource =
    link.kind === "resource" ? resources.get(link.publicId) : null;
  const subtask = link.kind === "subtask" ? subtasks.get(link.publicId) : null;

  if (resource?.kind === "web") {
    return (
      <CardCanvasWebResourceCard
        resource={resource}
        onOpenResource={() => onOpenResource(resource.publicId)}
      />
    );
  }

  return (
    <button
      type="button"
      onDoubleClick={() =>
        link.kind === "resource"
          ? onOpenResource(link.publicId)
          : onOpenSubtask(link.publicId)
      }
      className="flex h-full w-full flex-col justify-between overflow-hidden rounded-md border border-light-400 bg-light-50 p-4 text-left text-light-1000 dark:border-dark-500 dark:bg-dark-100 dark:text-dark-1000"
    >
      <span className="text-[10px] font-medium text-light-600 dark:text-dark-600">
        {link.kind === "resource" ? t`Card resource` : t`Card subtask`}
      </span>
      <span className="line-clamp-3 text-sm font-semibold">
        {resource?.title ?? subtask?.title ?? t`Unavailable item`}
      </span>
      <span className="text-[10px] text-light-600 dark:text-dark-600">
        {t`Double-click to open`}
      </span>
    </button>
  );
}
