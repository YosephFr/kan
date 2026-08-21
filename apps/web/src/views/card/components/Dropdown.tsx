import { t } from "@lingui/core/macro";
import { useState } from "react";
import {
  HiEllipsisHorizontal,
  HiHashtag,
  HiLink,
  HiOutlineCheckCircle,
  HiOutlineDocumentDuplicate,
  HiOutlineTrash,
} from "react-icons/hi2";

import Dropdown from "~/components/Dropdown";
import { useModal } from "~/providers/modal";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import { isPublicVisibilityAcknowledgementError } from "~/utils/card-workspace";
import { DuplicateCardConfirmationDialog } from "./DuplicateCardConfirmationDialog";

export default function CardDropdown({
  cardPublicId,
  isTemplate,
  boardPublicId,
  canEdit,
  canDelete,
  ticketNumber,
  listPublicId,
  cardIndex,
  uploadCount = 0,
  driveLinkCount = 0,
  isPublicBoard = false,
}: {
  cardPublicId: string;
  isTemplate?: boolean;
  boardPublicId?: string;
  canEdit: boolean;
  canDelete: boolean;
  ticketNumber?: string | null;
  listPublicId?: string;
  cardIndex?: number;
  uploadCount?: number;
  driveLinkCount?: number;
  isPublicBoard?: boolean;
}) {
  const { openModal } = useModal();
  const { showPopup } = usePopup();
  const utils = api.useUtils();
  const [isDuplicateWarningOpen, setIsDuplicateWarningOpen] = useState(false);
  const [requiresPublicAcknowledgement, setRequiresPublicAcknowledgement] =
    useState(false);

  const requiresPublicVisibilityAcknowledgement =
    requiresPublicAcknowledgement || (isPublicBoard && driveLinkCount > 0);
  const publicDriveLinkCount = requiresPublicVisibilityAcknowledgement
    ? driveLinkCount || undefined
    : undefined;

  const duplicateCard = api.card.duplicate.useMutation({
    onSuccess: (result) => {
      setIsDuplicateWarningOpen(false);
      setRequiresPublicAcknowledgement(false);
      showPopup({
        header: t`Card duplicated`,
        icon: "success",
        message:
          result.skippedResourceCount > 0
            ? t`Card duplicated. ${result.skippedResourceCount} uploaded files were not copied.`
            : t`Card duplicated successfully.`,
      });
    },
    onError: (error) => {
      if (isPublicVisibilityAcknowledgementError(error)) {
        setRequiresPublicAcknowledgement(true);
        setIsDuplicateWarningOpen(true);
        return;
      }
      showPopup({
        header: t`Unable to duplicate card`,
        icon: "error",
        message: t`Please try again.`,
      });
    },
    onSettled: async () => {
      await utils.board.byId.invalidate();
    },
  });

  const handleDuplicate = (publicVisibilityAcknowledged = false) => {
    if (!listPublicId || cardIndex === undefined) return;
    duplicateCard.mutate({
      cardPublicId,
      listPublicId,
      index: cardIndex + 1,
      copyLabels: true,
      copyMembers: true,
      copyChecklists: true,
      copyPipeline: true,
      publicVisibilityAcknowledged,
    });
  };

  const handleCopyCardLink = async () => {
    const path =
      isTemplate && boardPublicId
        ? `/templates/${boardPublicId}/cards/${cardPublicId}`
        : `/cards/${cardPublicId}`;
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      showPopup({
        header: t`Link copied`,
        icon: "success",
        message: t`Card URL copied to clipboard`,
      });
    } catch (error) {
      console.error(error);
      showPopup({
        header: t`Unable to copy link`,
        icon: "error",
        message: t`Please try again.`,
      });
    }
  };

  const handleCopyTicketId = async () => {
    if (!ticketNumber) return;
    try {
      await navigator.clipboard.writeText(ticketNumber);
      showPopup({
        header: t`ID copied`,
        icon: "success",
        message: t`Ticket ID copied to clipboard`,
      });
    } catch (error) {
      console.error(error);
      showPopup({
        header: t`Unable to copy ID`,
        icon: "error",
        message: t`Please try again.`,
      });
    }
  };

  const items = [
    {
      label: t`Copy card link`,
      action: handleCopyCardLink,
      icon: <HiLink className="h-[16px] w-[16px] text-dark-900" />,
    },
    ...(ticketNumber
      ? [
          {
            label: t`Copy ticket ID`,
            action: handleCopyTicketId,
            icon: <HiHashtag className="h-[16px] w-[16px] text-dark-900" />,
          },
        ]
      : []),
    ...(canEdit
      ? [
          {
            label: t`Add checklist`,
            action: () => openModal("ADD_CHECKLIST"),
            icon: (
              <HiOutlineCheckCircle className="h-[16px] w-[16px] text-dark-900" />
            ),
          },
          {
            label: t`Duplicate card`,
            action: () => {
              if (!listPublicId || cardIndex === undefined) return;
              if (uploadCount > 0 || requiresPublicVisibilityAcknowledgement) {
                setIsDuplicateWarningOpen(true);
                return;
              }
              handleDuplicate();
            },
            icon: (
              <HiOutlineDocumentDuplicate className="h-[16px] w-[16px] text-dark-900" />
            ),
            disabled: duplicateCard.isPending || !listPublicId,
          },
        ]
      : []),
    ...(canDelete
      ? [
          {
            label: t`Delete card`,
            action: () => openModal("DELETE_CARD"),
            icon: (
              <HiOutlineTrash className="h-[16px] w-[16px] text-dark-900" />
            ),
          },
        ]
      : []),
  ];

  if (items.length === 0) {
    return null;
  }

  return (
    <>
      <Dropdown items={items}>
        <HiEllipsisHorizontal className="h-5 w-5 text-dark-900" />
      </Dropdown>
      <DuplicateCardConfirmationDialog
        isOpen={isDuplicateWarningOpen}
        isLoading={duplicateCard.isPending}
        uploadCount={uploadCount}
        publicDriveLinkCount={publicDriveLinkCount}
        requiresPublicVisibilityAcknowledgement={
          requiresPublicVisibilityAcknowledgement
        }
        onCancel={() => {
          setIsDuplicateWarningOpen(false);
          setRequiresPublicAcknowledgement(false);
        }}
        onConfirm={() =>
          handleDuplicate(requiresPublicVisibilityAcknowledgement)
        }
      />
    </>
  );
}
