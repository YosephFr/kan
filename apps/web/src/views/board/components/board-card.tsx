import Link from "next/link";
import { env } from "next-runtime-env";
import { Draggable } from "react-beautiful-dnd";
import { twMerge } from "tailwind-merge";

import type { GetBoardByIdOutput } from "@kan/api/types";

import Card from "./Card";

type BoardCardData = GetBoardByIdOutput["lists"][number]["cards"][number];

interface BoardCardProps {
  card: BoardCardData;
  index: number;
  boardPublicId: string;
  cardPrefix: string;
  isTemplate: boolean;
  canEdit: boolean;
  isSelectionMode: boolean;
  isSelected: boolean;
  onToggle: (cardPublicId: string) => void;
  onOpenContextMenu: (
    cardPublicId: string,
    position: { x: number; y: number },
  ) => void;
}

export function BoardCard({
  card,
  index,
  boardPublicId,
  cardPrefix,
  isTemplate,
  canEdit,
  isSelectionMode,
  isSelected,
  onToggle,
  onOpenContextMenu,
}: BoardCardProps) {
  const isPlaceholder = card.publicId.startsWith("PLACEHOLDER");
  const cardClassName = twMerge(
    "mb-2 flex w-full flex-col rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-1000 focus-visible:ring-offset-2 dark:focus-visible:ring-dark-1000",
    isPlaceholder && "pointer-events-none",
  );
  const cardContent = (
    <Card
      title={card.title}
      ticketNumber={
        card.cardNumber != null ? `${cardPrefix}-${card.cardNumber}` : null
      }
      labels={card.labels}
      members={card.members}
      checklists={card.checklists}
      description={card.description ?? null}
      comments={card.comments}
      attachments={card.attachments}
      dueDate={card.dueDate ?? null}
      startedAt={card.startedAt ?? null}
      completedAt={card.completedAt ?? null}
      priority={card.priority}
      colourCode={card.colourCode}
      isSelectionMode={isSelectionMode}
      isSelected={isSelected}
    />
  );

  return (
    <Draggable
      draggableId={card.publicId}
      index={index}
      isDragDisabled={!canEdit || isSelectionMode}
    >
      {(provided) =>
        isSelectionMode ? (
          <button
            type="button"
            ref={provided.innerRef}
            {...provided.draggableProps}
            {...provided.dragHandleProps}
            className={cardClassName}
            disabled={isPlaceholder}
            aria-pressed={isSelected}
            onClick={() => onToggle(card.publicId)}
          >
            {cardContent}
          </button>
        ) : (
          <Link
            ref={provided.innerRef}
            {...provided.draggableProps}
            {...provided.dragHandleProps}
            href={
              isTemplate
                ? `/templates/${boardPublicId}/cards/${card.publicId}`
                : `/cards/${card.publicId}`
            }
            className={twMerge(cardClassName, "!cursor-pointer")}
            onClick={(event) => {
              if (isPlaceholder) event.preventDefault();
            }}
            onContextMenu={(event) => {
              if (isPlaceholder || env("NEXT_PUBLIC_KAN_ENV") === "cloud") {
                return;
              }

              event.preventDefault();
              event.currentTarget.focus();
              onOpenContextMenu(card.publicId, {
                x: event.clientX,
                y: event.clientY,
              });
            }}
          >
            {cardContent}
          </Link>
        )
      }
    </Draggable>
  );
}
