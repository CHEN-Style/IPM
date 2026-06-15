import 'dotenv/config';
import { z } from 'zod';

const optionalNonEmptyString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(4210),
  LOG_LEVEL: z.string().default('info'),

  DATABASE_URL: z.string().min(1),

  // C3.5 Auth: JWT signing secrets. In development these fall back to a fixed
  // dev secret so a fresh checkout works without extra config; production must
  // set strong unique values (validated below).
  JWT_SECRET: z.string().min(1).default('dev-insecure-access-secret-change-me'),
  JWT_REFRESH_SECRET: z.string().min(1).default('dev-insecure-refresh-secret-change-me'),
  JWT_ACCESS_EXPIRES: z.string().default('2h'),
  JWT_REFRESH_EXPIRES: z.string().default('30d'),

  // H1 (audit A7): brute-force protection on auth entry points. H8 makes the
  // limit tunable so automated regression (which legitimately issues many
  // register/login calls from one IP) can run against a relaxed server while
  // production keeps the strict default. `AUTH_RATE_LIMIT_MAX=0` disables auth
  // rate limiting entirely (test/dev only — never set 0 in production).
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(0).default(20),
  AUTH_RATE_LIMIT_WINDOW: z.string().default('1 minute'),

  // H6 Config Center: at-rest encryption key for org config templates
  // (`org_config_templates.config_json`, which may hold provider API keys).
  // Expected to be 32 bytes encoded as base64/hex; a shorter value is accepted
  // and stretched via scrypt. In development a fixed insecure key is derived so
  // a fresh checkout works; production must set a strong unique value.
  CONFIG_ENC_KEY: z.string().min(1).default('dev-insecure-config-enc-key-change-me'),

  OSS_REGION: optionalNonEmptyString,
  OSS_BUCKET: optionalNonEmptyString,
  OSS_ACCESS_KEY_ID: optionalNonEmptyString,
  OSS_ACCESS_KEY_SECRET: optionalNonEmptyString,
  OSS_ENDPOINT: optionalNonEmptyString,

  CORS_ORIGIN: z.string().default('*'),
});

export type Env = z.infer<typeof envSchema>;

export const env = envSchema.parse(process.env);

// In production, refuse to boot with the insecure default JWT secrets.
if (env.NODE_ENV === 'production') {
  if (env.JWT_SECRET.startsWith('dev-insecure') || env.JWT_REFRESH_SECRET.startsWith('dev-insecure')) {
    throw new Error(
      'JWT_SECRET / JWT_REFRESH_SECRET must be set to strong unique values in production.',
    );
  }
  if (env.CONFIG_ENC_KEY.startsWith('dev-insecure')) {
    throw new Error(
      'CONFIG_ENC_KEY must be set to a strong unique value in production.',
    );
  }
  if (env.AUTH_RATE_LIMIT_MAX === 0) {
    throw new Error('AUTH_RATE_LIMIT_MAX=0 (disabled) is not allowed in production.');
  }
}

export const ossConfigured =
  Boolean(env.OSS_REGION) &&
  Boolean(env.OSS_BUCKET) &&
  Boolean(env.OSS_ACCESS_KEY_ID) &&
  Boolean(env.OSS_ACCESS_KEY_SECRET);
