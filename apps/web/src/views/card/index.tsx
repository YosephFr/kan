import Link from "next/link";
import { useRouter } from "next/router";
import { t } from "@lingui/core/macro";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { HiXMark } from "react-icons/hi2";
import { IoChevronForwardSharp } from "react-icons/io5";

import { authClient } from "@kan/auth/client";

import Avatar from "~/components/Avatar";
import CardProgressBars from "~/components/CardProgressBars";
import Editor from "~/components/Editor";
import FeedbackModal from "~/components/FeedbackModal";
import { LabelForm } from "~/components/LabelForm";
import LabelIcon from "~/components/LabelIcon";
import Modal from "~/components/modal";
import { PageHead } from "~/components/PageHead";
import { EditYouTubeModal } from "~/components/YouTubeEmbed/EditYouTubeModal";
import { usePermissions } from "~/hooks/usePermissions";
import { useModal } from "~/providers/modal";
import { usePopup } from "~/providers/popup";
import { useWorkspace } from "~/providers/workspace";
import { api } from "~/utils/api";
import { isCardWorkspaceAligned } from "~/utils/card-workspace";
import { invalidateCard } from "~/utils/cardInvalidation";
import { formatMemberDisplayName, getAvatarUrl } from "~/utils/helpers";
import { DeleteLabelConfirmation } from "../../components/DeleteLabelConfirmation";
import ActivityList from "./components/ActivityList";
import {
  CardColourSelector,
  CardPrioritySelector,
} from "./components/CardFieldSelectors";
import { CardWorkspaceDocument } from "./components/CardWorkspaceDocument";
import Checklists from "./components/Checklists";
import { DeleteCardConfirmation } from "./components/DeleteCardConfirmation";
import { DeleteChecklistConfirmation } from "./components/DeleteChecklistConfirmation";
import { DeleteCommentConfirmation } from "./components/DeleteCommentConfirmation";
import Dropdown from "./components/Dropdown";
import { DueDateSelector } from "./components/DueDateSelector";
import LabelSelector from "./components/LabelSelector";
import ListSelector from "./components/ListSelector";
import MemberSelector from "./components/MemberSelector";
import { NewChecklistForm } from "./components/NewChecklistForm";
import NewCommentForm from "./components/NewCommentForm";

interface FormValues {
  cardId: string;
  title: string;
  description: string;
}

export function CardRightPanel({ isTemplate }: { isTemplate?: boolean }) {
  const router = useRouter();
  const { canEditCard } = usePermissions();
  const { workspace } = useWorkspace();
  const { data: session } = authClient.useSession();
  const cardId = Array.isArray(router.query.cardId)
    ? router.query.cardId[0]
    : router.query.cardId;
  const { data: card } = api.card.byId.useQuery(
    { cardPublicId: cardId ?? "" },
    { enabled: !!cardId && cardId.length >= 12 },
  );

  const isCreator = card?.createdBy && session?.user.id === card.createdBy;
  const workspaceAligned = isCardWorkspaceAligned(
    workspace.publicId,
    card?.list.board.workspace.publicId,
  );
  const canEdit = workspaceAligned && (canEditCard || !!isCreator);

  const board = card?.list.board;
  const labels = board?.labels;
  const workspaceMembers = board?.workspace.members;
  const selectedLabels = card?.labels;
  const selectedMembers = card?.members;

  const formattedLabels =
    labels?.map((label) => {
      const isSelected = selectedLabels?.some(
        (selectedLabel) => selectedLabel.publicId === label.publicId,
      );

      return {
        key: label.publicId,
        value: label.name,
        selected: isSelected ?? false,
        leftIcon: <LabelIcon colourCode={label.colourCode} />,
      };
    }) ?? [];

  const formattedLists =
    board?.lists.map((list) => ({
      key: list.publicId,
      value: list.name,
      selected: list.publicId === card?.list.publicId,
      status: list.status,
    })) ?? [];

  const formattedMembers =
    workspaceMembers?.map((member) => {
      const isSelected = selectedMembers?.some(
        (assignedMember) => assignedMember.publicId === member.publicId,
      );

      return {
        key: member.publicId,
        value: formatMemberDisplayName(
          member.user?.name ?? null,
          member.user?.email ?? member.email,
        ),
        imageUrl: member.user?.image
          ? getAvatarUrl(member.user.image)
          : undefined,
        selected: isSelected ?? false,
        leftIcon: (
          <Avatar
            size="xs"
            name={member.user?.name ?? ""}
            imageUrl={
              member.user?.image ? getAvatarUrl(member.user.image) : undefined
            }
            email={member.user?.email ?? member.email}
          />
        ),
      };
    }) ?? [];

  return (
    <div className="h-full w-full border-l-[1px] border-light-300 bg-light-50 p-4 text-light-900 dark:border-dark-300 dark:bg-dark-50 dark:text-dark-900 sm:p-8 md:w-[360px]">
      <div className="mb-4 flex w-full flex-row pt-[18px]">
        <p className="my-2 mb-2 w-[100px] text-sm font-medium">{t`List`}</p>
        <ListSelector
          cardPublicId={cardId ?? ""}
          lists={formattedLists}
          isLoading={!card}
          disabled={!canEdit}
          subtaskSummary={card?.subtaskSummary}
        />
      </div>
      <div className="mb-4 flex w-full flex-row">
        <p className="my-2 mb-2 w-[100px] text-sm font-medium">{t`Labels`}</p>
        <LabelSelector
          cardPublicId={cardId ?? ""}
          labels={formattedLabels}
          isLoading={!card}
          disabled={!canEdit}
        />
      </div>
      {!isTemplate && (
        <div className="mb-4 flex w-full flex-row">
          <p className="my-2 mb-2 w-[100px] text-sm font-medium">{t`Members`}</p>
          <MemberSelector
            cardPublicId={cardId ?? ""}
            members={formattedMembers}
            isLoading={!card}
            disabled={!canEdit}
          />
        </div>
      )}
      <div className="mb-4 flex w-full flex-row">
        <p className="my-2 mb-2 w-[100px] shrink-0 text-sm font-medium">
          {t`Priority`}
        </p>
        <CardPrioritySelector
          cardPublicId={cardId ?? ""}
          priority={card?.priority}
          disabled={!canEdit || !card}
        />
      </div>
      <div className="mb-4 flex w-full flex-row">
        <p className="my-2 mb-2 w-[100px] shrink-0 text-sm font-medium">
          {t`Colour`}
        </p>
        <CardColourSelector
          cardPublicId={cardId ?? ""}
          colourCode={card?.colourCode}
          disabled={!canEdit || !card}
        />
      </div>
      {!isTemplate && (
        <div className="mb-4 flex w-full flex-row">
          <p className="my-2 mb-2 w-[100px] shrink-0 text-sm font-medium">
            {t`Due date`}
          </p>
          <DueDateSelector
            cardPublicId={cardId ?? ""}
            dueDate={card?.dueDate}
            isLoading={!card}
            disabled={!canEdit}
          />
        </div>
      )}
      {!isTemplate && card && (
        <div className="mt-6 border-t border-light-300 pt-4 dark:border-dark-400">
          <CardProgressBars
            checklists={card.checklists}
            startedAt={card.startedAt}
            dueDate={card.dueDate}
            completedAt={card.completedAt}
          />
        </div>
      )}
    </div>
  );
}

export default function CardPage({ isTemplate }: { isTemplate?: boolean }) {
  const router = useRouter();
  const utils = api.useUtils();
  const {
    modalContentType,
    entityId,
    getModalState,
    clearModalState,
    isOpen,
    modalStates,
  } = useModal();
  const { showPopup } = usePopup();
  const { workspace, availableWorkspaces, switchWorkspace } = useWorkspace();
  const { canDeleteCard, canEditCard } = usePermissions();
  const { data: session } = authClient.useSession();
  const [activeChecklistForm, setActiveChecklistForm] = useState<string | null>(
    null,
  );

  const cardId = Array.isArray(router.query.cardId)
    ? router.query.cardId[0]
    : router.query.cardId;

  const {
    data: card,
    isLoading,
    error,
  } = api.card.byId.useQuery(
    { cardPublicId: cardId ?? "" },
    { enabled: !!cardId && cardId.length >= 12 },
  );

  useEffect(() => {
    const cardWorkspacePublicId = card?.list.board.workspace.publicId;
    if (
      !router.isReady ||
      !cardWorkspacePublicId ||
      workspace.publicId === cardWorkspacePublicId
    ) {
      return;
    }

    const targetWorkspace = availableWorkspaces.find(
      (candidate) => candidate.publicId === cardWorkspacePublicId,
    );
    if (targetWorkspace) {
      switchWorkspace(targetWorkspace, router.asPath);
    }
  }, [
    availableWorkspaces,
    card?.list.board.workspace.publicId,
    router.asPath,
    router.isReady,
    switchWorkspace,
    workspace.publicId,
  ]);

  // Redirect to 404 if card doesn't exist
  useEffect(() => {
    if (router.isReady && cardId && !isLoading) {
      if (error?.data?.code === "NOT_FOUND" || !card) {
        void router.replace("/404");
      }
    }
  }, [router, cardId, isLoading, error, card]);

  const isCreator = card?.createdBy && session?.user.id === card.createdBy;
  const workspaceAligned = isCardWorkspaceAligned(
    workspace.publicId,
    card?.list.board.workspace.publicId,
  );
  const canEdit = workspaceAligned && (canEditCard || !!isCreator);
  const canDelete = workspaceAligned && (canDeleteCard || !!isCreator);

  const refetchCard = async () => {
    if (cardId) await utils.card.byId.refetch({ cardPublicId: cardId });
  };

  const board = card?.list.board;
  const workspaceMembers = board?.workspace.members;
  const boardId = board?.publicId;

  const editorWorkspaceMembers =
    workspaceMembers
      ?.filter((member) => member.email)
      .map((member) => ({
        publicId: member.publicId,
        email: member.email,
        user: member.user
          ? {
              id: member.user.id,
              name: member.user.name ?? null,
              image: member.user.image ?? null,
            }
          : null,
      })) ?? [];

  const updateCard = api.card.update.useMutation({
    onError: () => {
      showPopup({
        header: t`Unable to update card`,
        message: t`Please try again later, or contact customer support.`,
        icon: "error",
      });
    },
    onSettled: async () => {
      if (cardId) await invalidateCard(utils, cardId);
    },
  });

  const { mutate: addOrRemoveLabel } = api.card.addOrRemoveLabel.useMutation({
    onError: () => {
      showPopup({
        header: t`Unable to add label`,
        message: t`Please try again later, or contact customer support.`,
        icon: "error",
      });
    },
    onSettled: async () => {
      if (cardId) {
        await utils.card.byId.invalidate({ cardPublicId: cardId });
      }
    },
  });

  const { register, handleSubmit, setValue } = useForm<FormValues>({
    values: {
      cardId: cardId ?? "",
      title: card?.title ?? "",
      description: card?.description ?? "",
    },
  });

  const onSubmit = (values: FormValues) => {
    updateCard.mutate({
      cardPublicId: values.cardId,
      title: values.title,
      description: values.description,
    });
  };

  // this adds the new created label to selected labels
  useEffect(() => {
    const newLabelId: unknown = modalStates.NEW_LABEL_CREATED;
    if (typeof newLabelId === "string" && cardId) {
      const isAlreadyAdded = card?.labels.some(
        (label) => label.publicId === newLabelId,
      );

      if (!isAlreadyAdded) {
        addOrRemoveLabel({
          cardPublicId: cardId,
          labelPublicId: newLabelId,
        });
      }
      clearModalState("NEW_LABEL_CREATED");
    }
  }, [
    addOrRemoveLabel,
    card,
    cardId,
    clearModalState,
    modalStates.NEW_LABEL_CREATED,
  ]);

  // Open the new item form after creating a new checklist
  useEffect(() => {
    if (!card) return;
    const state: unknown = getModalState("ADD_CHECKLIST");
    const createdId =
      typeof state === "object" &&
      state !== null &&
      "createdChecklistId" in state &&
      typeof state.createdChecklistId === "string"
        ? state.createdChecklistId
        : undefined;
    if (createdId) {
      setActiveChecklistForm(createdId);
      clearModalState("ADD_CHECKLIST");
    }
  }, [card, getModalState, clearModalState]);

  // Auto-resize title textarea
  useEffect(() => {
    const titleTextarea = document.getElementById("title");
    if (titleTextarea instanceof HTMLTextAreaElement) {
      titleTextarea.style.height = "auto";
      titleTextarea.style.height = `${titleTextarea.scrollHeight}px`;
    }
  }, [card]);

  if (!cardId) return <></>;

  return (
    <>
      <PageHead
        title={t`${card?.title ?? t`Card`} | ${board?.name ?? t`Board`}`}
      />
      <div className="flex h-full flex-1 flex-col overflow-hidden">
        <div className="w-full border-b border-light-300 bg-light-50 dark:border-dark-300 dark:bg-dark-50">
          <div className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2 md:px-8">
            {!card && isLoading && (
              <div className="flex space-x-2">
                <div className="h-[1.5rem] w-[150px] animate-pulse rounded-[5px] bg-light-300 dark:bg-dark-300" />
              </div>
            )}
            {card && (
              <>
                <div className="flex min-w-0 items-center gap-1 overflow-hidden">
                  <Link
                    className="shrink-0 whitespace-nowrap text-sm font-bold leading-[1.5rem] text-light-900 dark:text-dark-950"
                    href={`${isTemplate ? "/templates" : "/boards"}`}
                  >
                    {card.list.board.workspace.name}
                  </Link>
                  <IoChevronForwardSharp className="h-[10px] w-[10px] shrink-0 text-light-900 dark:text-dark-900" />
                  <Link
                    className="max-w-40 truncate text-sm font-bold leading-[1.5rem] text-light-900 dark:text-dark-950"
                    href={`${isTemplate ? "/templates" : "/boards"}/${board?.publicId}`}
                  >
                    {board?.name}
                  </Link>
                  {card.cardNumber != null &&
                    card.list.board.workspace.cardPrefix && (
                      <>
                        <IoChevronForwardSharp className="h-[10px] w-[10px] shrink-0 text-light-900 dark:text-dark-900" />
                        <span className="shrink-0 whitespace-nowrap text-sm font-bold leading-[1.5rem] text-light-700 dark:text-dark-800">
                          {card.list.board.workspace.cardPrefix}-
                          {card.cardNumber}
                        </span>
                      </>
                    )}
                  <IoChevronForwardSharp className="hidden h-[10px] w-[10px] shrink-0 text-light-700 dark:text-dark-700 lg:block" />
                  <span className="hidden truncate text-xs text-light-700 dark:text-dark-700 lg:block">
                    {card.title}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Dropdown
                    cardPublicId={cardId}
                    isTemplate={isTemplate}
                    boardPublicId={boardId}
                    canEdit={canEdit}
                    canDelete={canDelete}
                    ticketNumber={
                      card.cardNumber != null &&
                      card.list.board.workspace.cardPrefix
                        ? `${card.list.board.workspace.cardPrefix}-${card.cardNumber}`
                        : null
                    }
                    listPublicId={card.list.publicId}
                    cardIndex={card.index}
                    uploadCount={card.resourceSummary.uploads}
                    driveLinkCount={card.resourceSummary.driveLinks}
                    webLinkCount={card.resourceSummary.webLinks}
                    isPublicBoard={board?.visibility === "public"}
                  />
                  <Link
                    href={`/${isTemplate ? "templates" : "boards"}/${boardId}`}
                    className="flex h-7 w-7 items-center justify-center rounded-[5px] text-light-900 hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-800 dark:text-dark-900 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-800"
                    aria-label={t`Close`}
                  >
                    <HiXMark className="h-4 w-4" />
                  </Link>
                </div>
              </>
            )}
            {!card && !isLoading && (
              <p className="block p-0 py-0 font-bold leading-[1.5rem] tracking-tight text-light-900 dark:text-dark-900 sm:text-[1rem]">
                {t`Card not found`}
              </p>
            )}
          </div>
        </div>

        <div className="scrollbar-thumb-rounded-[4px] scrollbar-track-rounded-[4px] w-full flex-1 overflow-y-auto scrollbar scrollbar-track-light-200 scrollbar-thumb-light-400 hover:scrollbar-thumb-light-400 dark:scrollbar-track-dark-100 dark:scrollbar-thumb-dark-300 dark:hover:scrollbar-thumb-dark-300">
          {card ? (
            <CardWorkspaceDocument
              key={cardId}
              cardPublicId={cardId}
              cardTitle={card.title}
              members={
                canEdit
                  ? (workspaceMembers ?? [])
                      .filter((member) => member.status === "active")
                      .map((member) => ({
                        publicId: member.publicId,
                        email: member.email,
                        user: member.user
                          ? {
                              name: member.user.name ?? null,
                              email: member.user.email,
                              image: member.user.image ?? null,
                            }
                          : null,
                      }))
                  : []
              }
              canEdit={canEdit}
              isPublicBoard={board?.visibility === "public"}
              subtaskSummary={card.subtaskSummary}
              resourceSummary={card.resourceSummary}
              hasCanvas={card.hasCanvas}
              preferenceScope={session?.user.id ?? "signed-in"}
              summaryContent={
                <>
                  <form
                    onSubmit={handleSubmit(onSubmit)}
                    className="w-full space-y-6"
                  >
                    <textarea
                      id="title"
                      {...register("title")}
                      onBlur={canEdit ? handleSubmit(onSubmit) : undefined}
                      rows={1}
                      disabled={!canEdit}
                      className={`block w-full resize-none overflow-hidden border-0 bg-transparent p-0 font-bold leading-relaxed text-neutral-900 focus:ring-0 dark:text-dark-1000 sm:text-[1.2rem] ${!canEdit ? "cursor-default" : ""}`}
                      onInput={(event) => {
                        const target = event.target as HTMLTextAreaElement;
                        target.style.height = "auto";
                        target.style.height = `${target.scrollHeight}px`;
                      }}
                    />
                  </form>
                  <form
                    onSubmit={handleSubmit(onSubmit)}
                    className="mt-6 w-full"
                  >
                    <Editor
                      content={card.description}
                      onChange={
                        canEdit
                          ? (description) =>
                              setValue("description", description)
                          : undefined
                      }
                      onBlur={
                        canEdit ? () => handleSubmit(onSubmit)() : undefined
                      }
                      workspaceMembers={workspaceMembers ?? []}
                      readOnly={!canEdit}
                    />
                  </form>
                  {card.checklists.length > 0 && (
                    <div className="mt-10">
                      <Checklists
                        checklists={card.checklists}
                        cardPublicId={cardId}
                        activeChecklistForm={activeChecklistForm}
                        setActiveChecklistForm={setActiveChecklistForm}
                        viewOnly={!canEdit}
                      />
                    </div>
                  )}
                </>
              }
              activityContent={
                <>
                  <h2 className="text-md pb-4 font-medium text-light-1000 dark:text-dark-1000">
                    {t`Activity`}
                  </h2>
                  <ActivityList
                    cardPublicId={cardId}
                    isLoading={false}
                    isAdmin={workspace.role === "admin"}
                  />
                  {!isTemplate && (
                    <div className="mt-6">
                      <NewCommentForm
                        cardPublicId={cardId}
                        workspaceMembers={editorWorkspaceMembers}
                      />
                    </div>
                  )}
                </>
              }
            />
          ) : isLoading ? (
            <div className="mx-auto w-full max-w-6xl px-6 py-10 md:px-8">
              <div className="h-8 w-72 animate-pulse rounded-md bg-light-300 dark:bg-dark-300" />
              <div className="mt-8 h-28 max-w-3xl animate-pulse rounded-md bg-light-200 dark:bg-dark-200" />
            </div>
          ) : null}
        </div>

        <>
          <Modal
            modalSize="md"
            isVisible={isOpen && modalContentType === "NEW_FEEDBACK"}
          >
            <FeedbackModal />
          </Modal>

          <Modal
            modalSize="sm"
            isVisible={isOpen && modalContentType === "NEW_LABEL"}
          >
            <LabelForm boardPublicId={boardId ?? ""} refetch={refetchCard} />
          </Modal>

          <Modal
            modalSize="sm"
            isVisible={isOpen && modalContentType === "EDIT_LABEL"}
          >
            <LabelForm
              boardPublicId={boardId ?? ""}
              refetch={refetchCard}
              isEdit
            />
          </Modal>

          <Modal
            modalSize="sm"
            isVisible={isOpen && modalContentType === "DELETE_LABEL"}
          >
            <DeleteLabelConfirmation
              refetch={refetchCard}
              labelPublicId={entityId}
            />
          </Modal>

          <Modal
            modalSize="sm"
            isVisible={isOpen && modalContentType === "DELETE_CARD"}
          >
            <DeleteCardConfirmation
              boardPublicId={boardId ?? ""}
              cardPublicId={cardId}
            />
          </Modal>

          <Modal
            modalSize="sm"
            isVisible={isOpen && modalContentType === "DELETE_COMMENT"}
          >
            <DeleteCommentConfirmation
              cardPublicId={cardId}
              commentPublicId={entityId}
            />
          </Modal>

          <Modal
            modalSize="sm"
            isVisible={isOpen && modalContentType === "ADD_CHECKLIST"}
          >
            <NewChecklistForm cardPublicId={cardId} />
          </Modal>

          <Modal
            modalSize="sm"
            isVisible={isOpen && modalContentType === "DELETE_CHECKLIST"}
          >
            <DeleteChecklistConfirmation
              cardPublicId={cardId}
              checklistPublicId={entityId}
            />
          </Modal>

          <Modal
            modalSize="sm"
            isVisible={isOpen && modalContentType === "EDIT_YOUTUBE"}
          >
            <EditYouTubeModal />
          </Modal>
        </>
      </div>
    </>
  );
}
