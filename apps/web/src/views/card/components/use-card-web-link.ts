import { useCallback } from "react";

import type { WebCardResource } from "./card-resource-types";
import { api } from "~/utils/api";
import { invalidateCard } from "~/utils/cardInvalidation";
import { normalizeCardWebLink } from "./card-web-link";

export function useCreateCardWebLink(cardPublicId: string) {
  const utils = api.useUtils();
  const mutation = api.cardResource.createWebLink.useMutation();

  const createWebLink = useCallback(
    async (
      value: string,
      publicVisibilityAcknowledged?: boolean,
    ): Promise<WebCardResource> => {
      const url = normalizeCardWebLink(value);
      if (!url) throw new Error("INVALID_WEB_URL");
      const resource = await mutation.mutateAsync({
        cardPublicId,
        url,
        publicVisibilityAcknowledged,
      });
      if (resource.kind !== "web") throw new Error("INVALID_WEB_RESOURCE");
      await Promise.all([
        utils.cardResource.list.invalidate({ cardPublicId }),
        invalidateCard(utils, cardPublicId),
        utils.board.byId.invalidate(),
      ]);
      return resource;
    },
    [cardPublicId, mutation, utils],
  );

  return {
    createWebLink,
    isPending: mutation.isPending,
  };
}
