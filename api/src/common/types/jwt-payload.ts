/** JWT bearer payload issued by the account service. */
export interface JwtPayload {
  /** User id. */
  sub: number;
  email: string;
  /** Unique token id — used for the logout denylist. */
  jti: string;
  iat: number;
  exp: number;
}

/** Request principal attached by JwtAuthGuard. */
export interface AuthUser {
  id: number;
  email: string;
  jti: string;
  /** Unix seconds. */
  exp: number;
}

/** Minimal shape the guard needs on Express' request object. */
export interface RequestWithUser {
  headers: { authorization?: string };
  user?: AuthUser;
}
