import { TRPCError } from "@trpc/server";

export const isInstanceAdminEmail = (email?: string | null) => {
  if (!email) return false;

  const instanceAdmins = (process.env.INSTANCE_ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return instanceAdmins.includes(email.toLowerCase());
};

export const assertInstanceAdmin = (email?: string | null) => {
  if (!isInstanceAdminEmail(email)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Instance administrator access required",
    });
  }
};
