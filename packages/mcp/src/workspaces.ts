import { kanRequest } from "./client.js";

export interface WorkspaceSummary {
  publicId: string;
  name: string;
  slug: string;
}

export interface WorkspaceMembership {
  role: string;
  workspace: WorkspaceSummary;
}

export async function getWorkspaceMemberships(): Promise<
  WorkspaceMembership[]
> {
  return kanRequest<WorkspaceMembership[]>("GET", "/workspaces");
}

export async function getWorkspaceSummaries(): Promise<WorkspaceSummary[]> {
  return (await getWorkspaceMemberships()).map(({ workspace }) => workspace);
}
