import type { NextApiRequest } from "next";

const workspaceCanvasUploadProcedures = new Set([
  "workspaceCanvas.createImageUpload",
  "workspaceCanvas.confirmImageUpload",
]);

export const WORKSPACE_CANVAS_UPLOAD_HTTP_RATE_LIMIT_POINTS = 1_200;
export const ORDINARY_TRPC_RATE_LIMIT_COST = 12;

const getProcedurePaths = (req: NextApiRequest) => {
  const value = req.query.trpc;
  const rawPaths = Array.isArray(value) ? value : value ? [value] : [];
  return rawPaths.flatMap((path) => path.split(",")).filter(Boolean);
};

const isWorkspaceCanvasUploadRestRequest = (req: NextApiRequest) => {
  if (req.method !== "POST" || !Array.isArray(req.query.trpc)) return false;
  return /^workspaces\/[a-z0-9]{12}\/canvas\/images\/(upload|confirm)$/.test(
    req.query.trpc.join("/"),
  );
};

export const isWorkspaceCanvasUploadOnlyRequest = (req: NextApiRequest) => {
  if (isWorkspaceCanvasUploadRestRequest(req)) return true;
  const paths = getProcedurePaths(req);
  return (
    paths.length > 0 &&
    paths.every((path) => workspaceCanvasUploadProcedures.has(path))
  );
};

export interface WorkspaceCanvasUploadRateLimitProfile {
  identifier: string;
  pointsToConsume: number;
}

export const createWorkspaceCanvasUploadRateLimitProfileResolver = ({
  getVerifiedUserId,
  getIpIdentifier,
}: {
  getVerifiedUserId: (req: NextApiRequest) => Promise<string | undefined>;
  getIpIdentifier: (req: NextApiRequest) => string;
}) => {
  const cache = new WeakMap<
    NextApiRequest,
    Promise<WorkspaceCanvasUploadRateLimitProfile>
  >();
  return (req: NextApiRequest) => {
    const cached = cache.get(req);
    if (cached) return cached;
    const profile = (async () => {
      if (isWorkspaceCanvasUploadOnlyRequest(req)) {
        const userId = await getVerifiedUserId(req);
        if (userId) {
          return {
            identifier: `workspace-canvas-upload:${userId}`,
            pointsToConsume: 1,
          };
        }
      }
      return {
        identifier: `ip:${getIpIdentifier(req)}`,
        pointsToConsume: ORDINARY_TRPC_RATE_LIMIT_COST,
      };
    })();
    cache.set(req, profile);
    return profile;
  };
};
