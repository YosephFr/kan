import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import {
  HiOutlineCheckCircle,
  HiOutlinePlusSmall,
  HiOutlineRectangleStack,
} from "react-icons/hi2";

import type { GetBoardByIdOutput } from "@kan/api/types";

import Button from "~/components/Button";
import { Tooltip } from "~/components/Tooltip";
import BoardDropdown from "./BoardDropdown";
import Filters from "./Filters";
import UpdateBoardSlugButton from "./UpdateBoardSlugButton";
import VisibilityButton from "./VisibilityButton";

interface BoardHeaderActionsProps {
  isTemplate: boolean;
  isSelectingCards: boolean;
  isLoading: boolean;
  boardId: string;
  boardData?: GetBoardByIdOutput;
  workspaceSlug: string;
  workspaceRole: "admin" | "member" | "guest";
  canEditBoard: boolean;
  canEditCard: boolean;
  canCreateList: boolean;
  queryParams: React.ComponentProps<typeof VisibilityButton>["queryParams"];
  createListShortcutTooltipContent?: ReactNode;
  onOpenUpdateSlug: () => void;
  onToggleCardSelection: () => void;
  onCreateList: () => void;
}

export function BoardHeaderActions({
  isTemplate,
  isSelectingCards,
  isLoading,
  boardId,
  boardData,
  workspaceSlug,
  workspaceRole,
  canEditBoard,
  canEditCard,
  canCreateList,
  queryParams,
  createListShortcutTooltipContent,
  onOpenUpdateSlug,
  onToggleCardSelection,
  onCreateList,
}: BoardHeaderActionsProps) {
  return (
    <div className="order-1 mb-4 flex flex-wrap items-center justify-end gap-2 md:order-2 md:mb-0">
      {isTemplate && (
        <div className="inline-flex cursor-default items-center justify-center whitespace-nowrap rounded-md border-[1px] border-light-300 bg-light-50 px-3 py-2 text-sm font-semibold text-light-950 shadow-sm dark:border-dark-300 dark:bg-dark-50 dark:text-dark-950">
          <span className="mr-2">
            <HiOutlineRectangleStack />
          </span>
          {t`Template`}
        </div>
      )}
      {!isTemplate && !isSelectingCards && (
        <>
          <UpdateBoardSlugButton
            handleOnClick={onOpenUpdateSlug}
            isLoading={isLoading}
            workspaceSlug={workspaceSlug}
            boardSlug={boardData?.slug ?? ""}
            boardPublicId={boardId}
            visibility={
              boardData?.visibility === "public" ? "public" : "private"
            }
            canEdit={canEditBoard}
          />
          <VisibilityButton
            visibility={
              boardData?.visibility === "public" ? "public" : "private"
            }
            boardPublicId={boardId}
            boardSlug={boardData?.slug ?? ""}
            queryParams={queryParams}
            isLoading={!boardData}
            isAdmin={workspaceRole === "admin"}
          />
          {boardData && (
            <Filters
              labels={boardData.labels}
              members={boardData.workspace.members.filter(
                (member) => member.user !== null,
              )}
              lists={boardData.allLists}
              position="left"
              isLoading={!boardData}
            />
          )}
        </>
      )}
      {!isTemplate && canEditCard && boardData && (
        <Button
          variant={isSelectingCards ? "primary" : "secondary"}
          iconLeft={
            <HiOutlineCheckCircle className="h-5 w-5" aria-hidden="true" />
          }
          onClick={onToggleCardSelection}
          aria-pressed={isSelectingCards}
          aria-label={
            isSelectingCards ? t`Cancel card selection` : t`Select cards`
          }
        >
          {isSelectingCards ? t`Selecting cards` : t`Select cards`}
        </Button>
      )}
      {!isSelectingCards && (
        <>
          <Tooltip
            content={
              !canCreateList
                ? t`You don't have permission`
                : createListShortcutTooltipContent
            }
          >
            <Button
              iconLeft={
                <HiOutlinePlusSmall
                  className="-mr-0.5 h-5 w-5"
                  aria-hidden="true"
                />
              }
              onClick={onCreateList}
              disabled={!boardData || !canCreateList}
            >
              {t`New list`}
            </Button>
          </Tooltip>
          <BoardDropdown
            isTemplate={isTemplate}
            isLoading={!boardData}
            boardPublicId={boardId}
            isArchived={boardData?.isArchived ?? false}
            isFavorite={boardData?.favorite}
            boardName={boardData?.name}
          />
        </>
      )}
    </div>
  );
}
