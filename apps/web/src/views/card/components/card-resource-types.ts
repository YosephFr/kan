import type { RouterOutputs } from "~/utils/api";

export type CardResourceList = RouterOutputs["cardResource"]["list"];
export type CardResource = CardResourceList["resources"][number];
export type UploadCardResource = Extract<CardResource, { kind: "upload" }>;
export type DriveCardResource = Extract<CardResource, { kind: "drive" }>;
