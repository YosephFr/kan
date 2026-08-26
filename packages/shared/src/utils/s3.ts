import { createHash } from "node:crypto";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "next-runtime-env";

import { ATTACHMENT_SNIFF_BYTES } from "./attachments";

export function resolveS3Endpoint(usePublicEndpoint = false): string {
  const internalEndpoint = process.env.S3_ENDPOINT ?? "";
  if (usePublicEndpoint && process.env.S3_PUBLIC_ENDPOINT) {
    return process.env.S3_PUBLIC_ENDPOINT;
  }
  return internalEndpoint;
}

export function createS3Client(usePublicEndpoint = false) {
  const credentials =
    process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        }
      : undefined;

  // The AWS SDK throws "Region is missing" if region is undefined or
  // empty string at S3Client construction. Default to "us-east-1" so
  // S3-compatible providers (MinIO, Backblaze B2, R2, Spaces, Wasabi)
  // that don't care about region work without forcing operators to
  // set a meaningless value. Real AWS S3 users should still set
  // S3_REGION explicitly to their bucket's actual region.
  return new S3Client({
    region: process.env.S3_REGION ?? "us-east-1",
    endpoint: resolveS3Endpoint(usePublicEndpoint),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials,
  });
}

export async function generateUploadUrl(
  bucket: string,
  key: string,
  contentType: string,
  contentLength: number,
  expiresIn = 3600,
) {
  const client = createS3Client(true);
  return getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
      // Don't set ACL for private files
    }),
    { expiresIn },
  );
}

export async function generateDownloadUrl(
  bucket: string,
  key: string,
  expiresIn = 3600,
) {
  const client = createS3Client(true);
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
    { expiresIn },
  );
}

export async function deleteObject(bucket: string, key: string) {
  const client = createS3Client();
  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );
}

export async function putObject(input: {
  bucket: string;
  key: string;
  body: Uint8Array;
  contentType: string;
}) {
  const client = createS3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
      ContentLength: input.body.byteLength,
    }),
  );
}

export function attachmentContentDisposition(
  disposition: "attachment" | "inline",
  filename: string,
): string {
  const fallback = filename
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export async function getAttachmentObject(input: {
  bucket: string;
  key: string;
  range?: string;
}) {
  const client = createS3Client();
  return client.send(
    new GetObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      Range: input.range,
    }),
  );
}

export class ObjectInspectionSizeError extends Error {
  constructor(
    public readonly code:
      | "OBJECT_SIZE_UNAVAILABLE"
      | "OBJECT_SIZE_MISMATCH"
      | "OBJECT_TOO_LARGE",
  ) {
    super(code);
    this.name = "ObjectInspectionSizeError";
  }
}

export async function inspectObject(
  bucket: string,
  key: string,
  options: { maxBytes?: number; expectedBytes?: number } = {},
) {
  const client = createS3Client();
  const head = await client.send(
    new HeadObjectCommand({ Bucket: bucket, Key: key }),
  );
  if (!head.ETag) throw new Error("Attachment object ETag is missing");
  if (typeof head.ContentLength !== "number") {
    throw new ObjectInspectionSizeError("OBJECT_SIZE_UNAVAILABLE");
  }
  if (options.maxBytes !== undefined && head.ContentLength > options.maxBytes) {
    throw new ObjectInspectionSizeError("OBJECT_TOO_LARGE");
  }
  if (
    options.expectedBytes !== undefined &&
    head.ContentLength !== options.expectedBytes
  ) {
    throw new ObjectInspectionSizeError("OBJECT_SIZE_MISMATCH");
  }
  const object = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      IfMatch: head.ETag,
    }),
  );

  if (!object.Body) throw new Error("Attachment object body is missing");

  const hash = createHash("sha256");
  const prefix: number[] = [];
  for await (const value of object.Body as AsyncIterable<Uint8Array>) {
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
    hash.update(chunk);
    for (const byte of chunk) {
      if (prefix.length >= ATTACHMENT_SNIFF_BYTES) break;
      prefix.push(byte);
    }
  }

  return {
    contentType: head.ContentType ?? "",
    etag: head.ETag,
    prefix: new Uint8Array(prefix),
    sha256: hash.digest("hex"),
    size: head.ContentLength,
  };
}

export async function getObjectPrefix(
  bucket: string,
  key: string,
): Promise<Uint8Array> {
  const client = createS3Client();
  const object = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      Range: `bytes=0-${ATTACHMENT_SNIFF_BYTES - 1}`,
    }),
  );
  if (!object.Body) return new Uint8Array();
  return object.Body.transformToByteArray();
}

export async function copyObject(input: {
  bucket: string;
  sourceKey: string;
  destinationKey: string;
  sourceEtag: string;
  contentType: string;
}) {
  const client = createS3Client();
  await client.send(
    new CopyObjectCommand({
      Bucket: input.bucket,
      Key: input.destinationKey,
      CopySource: `${input.bucket}/${input.sourceKey}`,
      CopySourceIfMatch: input.sourceEtag,
      ContentType: input.contentType,
      MetadataDirective: "REPLACE",
    }),
  );
}

/**
 * Generate presigned URL for an avatar image
 * Returns the URL as-is if it's already a full URL (external provider)
 * Returns presigned URL if it's an S3 key
 * Returns null if image key is missing, bucket is not configured, or URL generation fails
 */
export async function generateAvatarUrl(
  imageKey: string | null | undefined,
  expiresIn = 86400, // 24 hours
): Promise<string | null> {
  if (!imageKey) {
    return null;
  }

  if (imageKey.startsWith("http://") || imageKey.startsWith("https://")) {
    return imageKey;
  }

  const bucket = env("NEXT_PUBLIC_AVATAR_BUCKET_NAME");
  if (!bucket) {
    return null;
  }

  try {
    return await generateDownloadUrl(bucket, imageKey, expiresIn);
  } catch {
    // If URL generation fails, return null
    return null;
  }
}

export async function generateWorkspaceLogoUrl(
  imageKey: string | null | undefined,
  expiresIn = 86400,
): Promise<string | null> {
  if (!imageKey) {
    return null;
  }

  if (imageKey.startsWith("http://") || imageKey.startsWith("https://")) {
    return imageKey;
  }

  const bucket = env("NEXT_PUBLIC_WORKSPACE_LOGOS_BUCKET_NAME");
  if (!bucket) {
    return null;
  }

  try {
    return await generateDownloadUrl(bucket, imageKey, expiresIn);
  } catch {
    return null;
  }
}
