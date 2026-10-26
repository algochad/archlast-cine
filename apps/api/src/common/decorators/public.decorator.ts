import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'account:isPublic';

/** Marks a route (or controller) as reachable without a Bearer token. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
