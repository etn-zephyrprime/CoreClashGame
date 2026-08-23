// backend/utils/r2Client.js
//
// Thin wrapper around the S3-compatible Cloudflare R2 API. R2 speaks the S3
// protocol, so the regular AWS SDK works against it — just point `endpoint`
// at the account's R2 endpoint and use region "auto".
//
// Required env vars (see backend/.env.example):
//   R2_ACCOUNT_ID
//   R2_ACCESS_KEY_ID
//   R2_SECRET_ACCESS_KEY
//   R2_BUCKET_NAME
//
// If any are missing, R2_ENABLED is false and every helper below becomes a
// harmless no-op — the app still runs entirely off local disk, it just
// won't survive a free-tier restart. This lets local dev run without R2
// credentials at all.
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME,
} = process.env;

export const R2_ENABLED = Boolean(
  R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME
);

export const R2_BUCKET = R2_BUCKET_NAME;

let client = null;

if (R2_ENABLED) {
  client = new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });

  console.log(`[R2] enabled — bucket "${R2_BUCKET_NAME}"`);
} else {
  console.warn(
    "[R2] R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME " +
      "not fully set — backend/data will NOT be backed up to Cloudflare R2. " +
      "Running in local-disk-only mode."
  );
}

export async function putObject(key, body) {
  if (!R2_ENABLED) return;
  await client.send(
    new PutObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key, Body: body })
  );
}

/** Returns a Buffer, or null if the key doesn't exist. */
export async function getObject(key) {
  if (!R2_ENABLED) return null;

  try {
    const res = await client.send(
      new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key })
    );
    const bytes = await res.Body.transformToByteArray();
    return Buffer.from(bytes);
  } catch (err) {
    if (err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw err;
  }
}

/** Lists every key in the bucket (optionally under a prefix), paging as needed. */
export async function listAllKeys(prefix = "") {
  if (!R2_ENABLED) return [];

  const keys = [];
  let ContinuationToken;

  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET_NAME,
        Prefix: prefix,
        ContinuationToken,
      })
    );

    for (const obj of res.Contents || []) {
      keys.push(obj.Key);
    }

    ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (ContinuationToken);

  return keys;
}
