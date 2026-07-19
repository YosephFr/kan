import { eq } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import { instanceSettings } from "@kan/db/schema";

export interface InstanceSettingsInput {
  brandName: string;
  brandLogo: string | null;
  loginTitle: string | null;
  loginDescription: string | null;
  updatedBy: string;
}

export const get = async (db: dbClient) => {
  return db.query.instanceSettings.findFirst({
    columns: {
      brandName: true,
      brandLogo: true,
      loginTitle: true,
      loginDescription: true,
    },
    where: eq(instanceSettings.id, 1),
  });
};

export const upsert = async (db: dbClient, input: InstanceSettingsInput) => {
  const [result] = await db
    .insert(instanceSettings)
    .values({ id: 1, ...input, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: instanceSettings.id,
      set: { ...input, updatedAt: new Date() },
    })
    .returning({
      brandName: instanceSettings.brandName,
      brandLogo: instanceSettings.brandLogo,
      loginTitle: instanceSettings.loginTitle,
      loginDescription: instanceSettings.loginDescription,
    });

  return result;
};
