import type { NextApiRequest } from "next";

export const WORKSPACE_CANVAS_IMAGE_VIEW_HTTP_RATE_LIMIT_POINTS = 6_000;
export const UNAUTHENTICATED_IMAGE_VIEW_RATE_LIMIT_COST = 60;

export interface WorkspaceCanvasImageViewRateLimitProfile {
  identifier: string;
  pointsToConsume: number;
}

export const createWorkspaceCanvasImageViewRateLimitProfileResolver = ({
  getVerifiedUserId,
  getIpIdentifier,
}: {
  getVerifiedUserId: (req: NextApiRequest) => Promise<string | undefined>;
  getIpIdentifier: (req: NextApiRequest) => string;
}) => {
  const cache = new WeakMap<
    NextApiRequest,
    Promise<WorkspaceCanvasImageViewRateLimitProfile>
  >();
  return (req: NextApiRequest) => {
    const cached = cache.get(req);
    if (cached) return cached;
    const profile = (async () => {
      const userId = await getVerifiedUserId(req).catch(() => undefined);
      return userId
        ? {
            identifier: `workspace-canvas-image-view:${userId}`,
            pointsToConsume: 1,
          }
        : {
            identifier: `workspace-canvas-image-view-unauthenticated:${getIpIdentifier(req)}`,
            pointsToConsume: UNAUTHENTICATED_IMAGE_VIEW_RATE_LIMIT_COST,
          };
    })();
    cache.set(req, profile);
    return profile;
  };
};
