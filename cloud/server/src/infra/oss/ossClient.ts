import OSS from 'ali-oss';
import { env, ossConfigured } from '../../config/env.js';

function getOssConfig() {
  if (!ossConfigured) return null;
  const { OSS_REGION, OSS_BUCKET, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET, OSS_ENDPOINT } = env;
  if (!OSS_REGION || !OSS_BUCKET || !OSS_ACCESS_KEY_ID || !OSS_ACCESS_KEY_SECRET) return null;
  return {
    region: OSS_REGION,
    bucket: OSS_BUCKET,
    accessKeyId: OSS_ACCESS_KEY_ID,
    accessKeySecret: OSS_ACCESS_KEY_SECRET,
    endpoint: OSS_ENDPOINT,
  };
}

export function createOssClient() {
  const config = getOssConfig();
  if (!config) return null;

  return new OSS({
    region: config.region,
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    endpoint: config.endpoint,
  });
}

export async function checkOssConfig() {
  if (!ossConfigured) {
    return {
      configured: false,
      ok: false,
      reason: 'OSS env vars are not fully configured',
    };
  }

  const config = getOssConfig();
  const client = createOssClient();
  if (!config || !client) {
    return {
      configured: true,
      ok: false,
      reason: 'OSS client was not created',
    };
  }

  try {
    await client.getBucketInfo(config.bucket);
    return {
      configured: true,
      ok: true,
      bucket: config.bucket,
      region: config.region,
    };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      bucket: config.bucket,
      region: config.region,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// All blob uploads use this fixed content type. It MUST be signed into the
// URL and sent verbatim by the client, otherwise OSS rejects the PUT with
// SignatureDoesNotMatch (Content-Type is part of the signed string-to-sign).
export const BLOB_UPLOAD_CONTENT_TYPE = 'application/octet-stream';

export function getSignedPutUrl(objectKey: string, expiresSeconds = 900) {
  const client = createOssClient();
  if (!client) throw new Error('OSS is not configured');

  return client.signatureUrl(objectKey, {
    method: 'PUT',
    expires: expiresSeconds,
    'Content-Type': BLOB_UPLOAD_CONTENT_TYPE,
  });
}
