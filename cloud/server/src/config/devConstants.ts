// C3: Fixed development identity used by the Dev Auth flow and the seed
// script. These are intentionally stable UUIDs so that a desktop client
// configured with the same dev user id can talk to a freshly seeded
// database without any login. Replaced by real auth (JWT) in a later phase.

export const DEV_USER_ID = '00000000-0000-4000-8000-000000000001';
export const DEV_USER_EMAIL = 'dev@ipm.local';
export const DEV_USER_DISPLAY_NAME = 'Dev User';

export const DEV_ORG_ID = '00000000-0000-4000-8000-000000000002';
export const DEV_ORG_NAME = 'Dev Org';
export const DEV_ORG_SLUG = 'dev';
