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

  OSS_REGION: optionalNonEmptyString,
  OSS_BUCKET: optionalNonEmptyString,
  OSS_ACCESS_KEY_ID: optionalNonEmptyString,
  OSS_ACCESS_KEY_SECRET: optionalNonEmptyString,
  OSS_ENDPOINT: optionalNonEmptyString,

  CORS_ORIGIN: z.string().default('*'),
});

export type Env = z.infer<typeof envSchema>;

export const env = envSchema.parse(process.env);

export const ossConfigured =
  Boolean(env.OSS_REGION) &&
  Boolean(env.OSS_BUCKET) &&
  Boolean(env.OSS_ACCESS_KEY_ID) &&
  Boolean(env.OSS_ACCESS_KEY_SECRET);
