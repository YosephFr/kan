import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { useState } from "react";
import { Draggable } from "react-beautiful-dnd";
import { useForm } from "react-hook-form";
import {
  HiEllipsisHorizontal,
  HiOutlinePlusSmall,
  HiOutlineSquaresPlus,
  HiOutlineSwatch,
  HiOutlineTrash,
} from "react-icons/hi2";

import { authClient } from "@kan/auth/client";

import type { ListStatus } from "~/utils/card-presentation";
import Dropdown from "~/components/Dropdown";
import { Tooltip } from "~/components/Tooltip";
import { usePermissions } from "~/hooks/usePermissions";
import { useModal } from "~/providers/modal";
import { api } from "~/utils/api";
import ListSettingsDialog from "./ListSettingsDialog";

interface ListProps {
  children: ReactNode;
  index: number;
  list: List;
  isSelectionMode?: boolean;
  setSelectedPublicListId: (publicListId: PublicListId) => void;
}

interface List {
  publicId: string;
  name: string;
  createdBy?: string | null;
  status?: ListStatus | null;
  colourCode?: string | null;
  cards?: {
    subtaskSummary?: {
      total: number;
      completed: number;
    };
  }[];
}

interface FormValues {
  listPublicId: string;
  name: string;
}

type PublicListId = string;

export default function List({
  children,
  index,
  list,
  isSelectionMode = false,
  setSelectedPublicListId,
}: ListProps) {
  const { openModal } = useModal();
  const { canCreateCard, canEditList, canDeleteList } = usePermissions();
  const { data: session } = authClient.useSession();
  const isCreator = list.createdBy && session?.user.id === list.createdBy;
  const canEdit = canEditList || isCreator;
  const canDrag = canEditList || isCreator;
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const openNewCardForm = (publicListId: PublicListId) => {
    if (!canCreateCard) return;
    openModal("NEW_CARD");
    setSelectedPublicListId(publicListId);
  };

  const updateList = api.list.update.useMutation();

  const { register, handleSubmit } = useForm<FormValues>({
    defaultValues: {
      listPublicId: list.publicId,
      name: list.name,
    },
    values: {
      listPublicId: list.publicId,
      name: list.name,
    },
  });

  const onSubmit = (values: FormValues) => {
    if (!canEdit) return;
    updateList.mutate({
      listPublicId: values.listPublicId,
      name: values.name,
    });
  };

  const handleOpenDeleteListConfirmation = () => {
    setSelectedPublicListId(list.publicId);
    openModal("DELETE_LIST");
  };

  return (
    <>
      <Draggable
        key={list.publicId}
        draggableId={list.publicId}
        index={index}
        isDragDisabled={!canDrag || isSelectionMode}
      >
        {(provided) => (
          <div
            key={list.publicId}
            ref={provided.innerRef}
            {...provided.draggableProps}
            {...provided.dragHandleProps}
            className="dark-text-dark-1000 relative mr-5 h-fit min-w-[18rem] max-w-[18rem] snap-start rounded-md border border-light-400 bg-light-300 py-2 pl-2 pr-1 text-neutral-900 dark:border-dark-300 dark:bg-dark-100 md:snap-align-none"
          >
            {list.colourCode && (
              <span
                className="absolute inset-x-0 top-0 h-1 rounded-t-md"
                style={{ backgroundColor: list.colourCode }}
                aria-hidden="true"
              />
            )}
            <div className="mb-2 flex justify-between">
              <form
                onSubmit={handleSubmit(onSubmit)}
                className="w-full focus-visible:outline-none"
              >
                <div className="flex items-center">
                  {list.colourCode && (
                    <span
                      className="ml-3 h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: list.colourCode }}
                      aria-hidden="true"
                    />
                  )}
                  <input
                    id={`list-name-${list.publicId}`}
                    type="text"
                    {...register("name")}
                    onBlur={handleSubmit(onSubmit)}
                    readOnly={!canEdit}
                    className="w-full border-0 bg-transparent px-2 pt-1 text-sm font-medium text-neutral-900 focus:ring-0 focus-visible:outline-none dark:text-dark-1000"
                  />
                </div>
              </form>
              <div className="flex items-center">
                <Tooltip
                  content={
                    !canCreateCard ? t`You don't have permission` : undefined
                  }
                >
                  <button
                    className="mx-1 inline-flex h-fit items-center rounded-md p-1 px-1 text-sm font-semibold text-dark-50 hover:bg-light-400 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-dark-200"
                    onClick={() => openNewCardForm(list.publicId)}
                    disabled={!canCreateCard}
                  >
                    <HiOutlinePlusSmall
                      className="h-5 w-5 text-dark-900"
                      aria-hidden="true"
                    />
                  </button>
                </Tooltip>
                {(() => {
                  const dropdownItems = [
                    ...(canCreateCard
                      ? [
                          {
                            label: t`Add a card`,
                            action: () => openNewCardForm(list.publicId),
                            icon: (
                              <HiOutlineSquaresPlus className="h-[18px] w-[18px] text-dark-900" />
                            ),
                          },
                        ]
                      : []),
                    ...(canEdit
                      ? [
                          {
                            label: t`List appearance and type`,
                            action: () => setIsSettingsOpen(true),
                            icon: (
                              <HiOutlineSwatch className="h-[18px] w-[18px] text-dark-900" />
                            ),
                          },
                        ]
                      : []),
                    ...(canDeleteList || isCreator
                      ? [
                          {
                            label: t`Delete list`,
                            action: handleOpenDeleteListConfirmation,
                            icon: (
                              <HiOutlineTrash className="h-[18px] w-[18px] text-dark-900" />
                            ),
                          },
                        ]
                      : []),
                  ];

                  if (dropdownItems.length === 0) {
                    return null;
                  }

                  return (
                    <div className="relative mr-1 inline-block">
                      <Dropdown items={dropdownItems}>
                        <HiEllipsisHorizontal className="h-5 w-5 text-dark-900" />
                      </Dropdown>
                    </div>
                  );
                })()}
              </div>
            </div>
            {children}
          </div>
        )}
      </Draggable>
      <ListSettingsDialog
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        list={list}
      />
    </>
  );
}
