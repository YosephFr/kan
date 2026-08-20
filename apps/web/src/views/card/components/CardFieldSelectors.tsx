import { t } from "@lingui/core/macro";

import type { CardPriority } from "~/utils/card-presentation";
import AccentColourSelector from "~/components/AccentColourSelector";
import PrioritySelector from "~/components/PrioritySelector";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import { invalidateCard } from "~/utils/cardInvalidation";

interface CardFieldSelectorProps {
  cardPublicId: string;
  disabled?: boolean;
}

export function CardPrioritySelector({
  cardPublicId,
  priority,
  disabled = false,
}: CardFieldSelectorProps & { priority?: CardPriority | null }) {
  const utils = api.useUtils();
  const { showPopup } = usePopup();
  const update = api.card.update.useMutation({
    onError: () => {
      showPopup({
        header: t`Unable to update priority`,
        message: t`Please try again later, or contact customer support.`,
        icon: "error",
      });
    },
    onSettled: async () => {
      await invalidateCard(utils, cardPublicId);
      await utils.board.byId.invalidate();
    },
  });

  return (
    <PrioritySelector
      value={priority ?? "none"}
      disabled={disabled || update.isPending}
      compact
      onChange={(value) => update.mutate({ cardPublicId, priority: value })}
    />
  );
}

export function CardColourSelector({
  cardPublicId,
  colourCode,
  disabled = false,
}: CardFieldSelectorProps & { colourCode?: string | null }) {
  const utils = api.useUtils();
  const { showPopup } = usePopup();
  const update = api.card.update.useMutation({
    onError: () => {
      showPopup({
        header: t`Unable to update colour`,
        message: t`Please try again later, or contact customer support.`,
        icon: "error",
      });
    },
    onSettled: async () => {
      await invalidateCard(utils, cardPublicId);
      await utils.board.byId.invalidate();
    },
  });

  return (
    <AccentColourSelector
      value={colourCode}
      disabled={disabled || update.isPending}
      compact
      onChange={(value) => update.mutate({ cardPublicId, colourCode: value })}
    />
  );
}
