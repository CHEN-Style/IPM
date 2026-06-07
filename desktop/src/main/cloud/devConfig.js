// C3: Temporary development configuration for cloud connectivity.
//
// This hardcodes the Cloud API base URL and the dev user/org identity so the
// publish flow works without a real login. It mirrors the seed data inserted
// by the cloud server's `npm run db:seed`. Replaced by a dynamic, token-based
// configuration once real auth lands (between C3 and C4).
//
// Values can be overridden via environment variables for local testing.

export const CLOUD_DEV_CONFIG = {
  baseURL: process.env.IPM_CLOUD_BASE_URL || 'http://127.0.0.1:4210',
  devUserId: process.env.IPM_CLOUD_DEV_USER_ID || '00000000-0000-4000-8000-000000000001',
  devOrgId: process.env.IPM_CLOUD_DEV_ORG_ID || '00000000-0000-4000-8000-000000000002',
  devOrgSlug: process.env.IPM_CLOUD_DEV_ORG_SLUG || 'dev',
  devOrgName: process.env.IPM_CLOUD_DEV_ORG_NAME || 'Dev Org',
  devUserDisplayName: process.env.IPM_CLOUD_DEV_USER_NAME || 'Dev User',
};
