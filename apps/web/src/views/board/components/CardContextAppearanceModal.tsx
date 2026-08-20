import { t } from "@lingui/core/macro";

import Modal from "~/components/modal";
import { useModal } from "~/providers/modal";
import { api } from "~/utils/api";
import {
  CardColourSelector,
  CardPrioritySelector,
} from "~/views/card/components/CardFieldSelectors";

export function CardContextAppearanceModal() {
  const {
    entityId: cardPublicId,
    closeModal,
    isOpen,
    modalContentType,
  } = useModal();
  const field =
    modalContentType === "CARD_CONTEXT_PRIORITY"
      ? "priority"
      : modalContentType === "CARD_CONTEXT_COLOUR"
        ? "colour"
        : null;
  const { data: card, isLoading } = api.card.byId.useQuery(
    { cardPublicId },
    { enabled: field !== null && cardPublicId.length >= 12 },
  );

  return (
    <Modal modalSize="sm" isVisible={isOpen && field !== null}>
      <div className="p-4">
        <h2 className="mb-4 text-lg font-semibold text-light-1000 dark:text-dark-1000">
          {field === "priority" ? t`Set priority` : t`Set card colour`}
        </h2>
        {isLoading ? (
          <div className="h-10 w-full animate-pulse rounded bg-light-200 dark:bg-dark-300" />
        ) : field === "priority" ? (
          <CardPrioritySelector
            cardPublicId={cardPublicId}
            priority={card?.priority}
          />
        ) : (
          <CardColourSelector
            cardPublicId={cardPublicId}
            colourCode={card?.colourCode}
          />
        )}
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={closeModal}
            className="rounded-md border border-light-300 bg-light-50 px-3 py-1.5 text-sm font-medium text-light-1000 hover:bg-light-200 dark:border-dark-400 dark:bg-dark-200 dark:text-dark-1000 dark:hover:bg-dark-300"
          >
            {t`Done`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
