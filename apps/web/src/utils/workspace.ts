export const buildWorkspaceCreateInput = (name: string, slug?: string) => ({
  name,
  ...(slug ? { slug } : {}),
});
