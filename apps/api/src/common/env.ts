import type { JwtModuleOptions } from '@nestjs/jwt';

/** Runtime configuration read from the environment at import time. */

/** Long dev fallback so local runs work without an .env file. */
const DEV_SECRET = 'archlast-cine-dev-secret-please-override-in-production-7f3d9a1c';

const configuredSecret = process.env.JWT_SECRET?.trim();

/** True when {@link JWT_SECRET} fell back to the built-in dev value. */
export const JWT_SECRET_IS_DEFAULT = !configuredSecret;

export const JWT_SECRET: string = configuredSecret || DEV_SECRET;

/** `jsonwebtoken` types the TTL as a literal union (`"30d"`), hence the cast. */
type JwtExpiry = NonNullable<JwtModuleOptions['signOptions']>['expiresIn'];

export const JWT_TTL = (process.env.JWT_TTL?.trim() || '30d') as JwtExpiry;

export const DEFAULT_PORT = 4100;

export const PORT: number = Number(process.env.API_PORT ?? process.env.PORT ?? DEFAULT_PORT);

export const HOST: string = process.env.API_HOST?.trim() || '0.0.0.0';

export const DATABASE_URL: string =
  process.env.DATABASE_URL?.trim() || 'postgres://moviebox:moviebox@127.0.0.1:5432/moviebox';

export const REDIS_URL: string = process.env.REDIS_URL?.trim() || 'redis://127.0.0.1:6379';

/** Login attempts per email+ip inside {@link LOGIN_WINDOW_SECONDS} before 429. */
export const LOGIN_MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS ?? 10);

export const LOGIN_WINDOW_SECONDS = Number(process.env.LOGIN_WINDOW_SECONDS ?? 900);

/** `prisma db push` on boot — dev parity with a synchronize-on-start stack. */
export const PRISMA_AUTO_PUSH = process.env.PRISMA_AUTO_PUSH !== '0';
