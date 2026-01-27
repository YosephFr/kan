import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export function createS3Client(usePublicEndpoint = false) {
  const credentials =
    process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        }
      : undefined;

  const endpoint = usePublicEndpoint && process.env.S3_PUBLIC_ENDPOINT
    ? process.env.S3_PUBLIC_ENDPOINT
    : process.env.S3_ENDPOINT ?? "";

  return new S3Client({
    region: process.env.S3_REGION ?? "",
    endpoint,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials,
  });
}

export async function generateUploadUrl(
  bucket: string,
  key: string,
  contentType: string,
  expiresIn = 3600,
) {
  const client = createS3Client(true);
  return getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
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
