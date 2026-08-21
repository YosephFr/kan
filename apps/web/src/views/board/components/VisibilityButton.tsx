import { t } from "@lingui/core/macro";
import { useEffect, useState } from "react";
import { HiOutlineEye, HiOutlineEyeSlash } from "react-icons/hi2";

import Button from "~/components/Button";
import CheckboxDropdown from "~/components/CheckboxDropdown";
import { MakeBoardPublicDialog } from "~/components/MakeBoardPublicDialog";
import { Tooltip } from "~/components/Tooltip";
import { usePermissions } from "~/hooks/usePermissions";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import { isPublicVisibilityAcknowledgementError } from "~/utils/card-workspace";
import { getBoardResourceCount } from "~/utils/resource-summary";

interface QueryParams {
  boardPublicId: string;
  members: string[];
  labels: string[];
  lists: string[];
}

const VisibilityButton = ({
  visibility,
  boardPublicId,
  queryParams,
  isLoading,
  isAdmin,
}: {
  visibility: "public" | "private";
  boardPublicId: string;
  boardSlug: string;
  queryParams: QueryParams;
  isLoading: boolean;
  isAdmin: boolean;
}) => {
  const { showPopup } = usePopup();
  const { canEditBoard } = usePermissions();
  const utils = api.useUtils();
  const [stateVisibility, setStateVisibility] = useState<"public" | "private">(
    visibility,
  );
  const [isPublicConfirmationOpen, setIsPublicConfirmationOpen] =
    useState(false);
  const resourceBoardQuery = api.board.byId.useQuery(
    { boardPublicId, members: [], labels: [], lists: [] },
    { enabled: stateVisibility === "private" },
  );
  const resourceCount = getBoardResourceCount(
    resourceBoardQuery.data?.lists ?? [],
  );

  useEffect(() => {
    setStateVisibility(visibility);
  }, [visibility]);

  const isPublic = stateVisibility === "public";

  const updateBoardVisibility = api.board.update.useMutation({
    onSuccess: (_, variables) => {
      setStateVisibility(variables.visibility ?? visibility);
      setIsPublicConfirmationOpen(false);
      showPopup({
        header: t`Board visibility updated`,
        message: t`The visibility of your board has been set to ${variables.visibility ?? visibility}.`,
        icon: "success",
      });
    },
    onError: (error) => {
      if (isPublicVisibilityAcknowledgementError(error)) {
        setIsPublicConfirmationOpen(true);
        void resourceBoardQuery.refetch();
        return;
      }
      setStateVisibility(visibility);
      showPopup({
        header: t`Unable to update board visibility`,
        message: t`Please try again later, or contact customer support.`,
        icon: "error",
      });
    },
    onSettled: async () => {
      await utils.board.byId.invalidate(queryParams);
    },
  });

  const canEdit = canEditBoard || isAdmin;

  const updateVisibility = (
    nextVisibility: "public" | "private",
    publicVisibilityAcknowledged = false,
  ) => {
    updateBoardVisibility.mutate({
      visibility: nextVisibility,
      boardPublicId,
      publicVisibilityAcknowledged,
    });
  };

  return (
    <div className="relative">
      <Tooltip
        content={
          !canEdit && !isLoading ? t`You don't have permission` : undefined
        }
      >
        <CheckboxDropdown
          items={[
            {
              key: "public",
              value: t`Public`,
              selected: isPublic,
            },
            {
              key: "private",
              value: t`Private`,
              selected: !isPublic,
            },
          ]}
          handleSelect={(_g, i) => {
            if (!canEdit) return;
            const nextVisibility = i.key as "public" | "private";
            if (nextVisibility === stateVisibility) return;
            if (nextVisibility === "public" && !resourceBoardQuery.data) {
              showPopup({
                header: t`Unable to verify public resources`,
                message: t`Reload the board and try again before making it public.`,
                icon: "error",
              });
              return;
            }
            if (nextVisibility === "public" && resourceCount > 0) {
              setIsPublicConfirmationOpen(true);
              return;
            }
            updateVisibility(nextVisibility);
          }}
          menuSpacing="md"
        >
          <Button
            variant="secondary"
            iconLeft={isPublic ? <HiOutlineEye /> : <HiOutlineEyeSlash />}
            disabled={
              isLoading ||
              resourceBoardQuery.isLoading ||
              updateBoardVisibility.isPending ||
              !canEdit
            }
          >
            {t`Visibility`}
          </Button>
        </CheckboxDropdown>
      </Tooltip>
      <MakeBoardPublicDialog
        isOpen={isPublicConfirmationOpen}
        isLoading={updateBoardVisibility.isPending}
        resourceCount={resourceCount || undefined}
        onCancel={() => setIsPublicConfirmationOpen(false)}
        onConfirm={() => updateVisibility("public", true)}
      />
    </div>
  );
};

export default VisibilityButton;
