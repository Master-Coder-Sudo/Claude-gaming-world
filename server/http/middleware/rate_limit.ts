// Rate-limit middleware adapter for the API pipeline onion (Phase 8 of
// docs/api-pipeline/). A THIN wrapper over the existing boolean limiters
// (server/ratelimit.ts): no new limiter behavior, no store, no schema (a keyed
// sliding-window store is Phase 19's job). Importable but UNMOUNTED here;
// Phase 9 places it in front of the routes that need it.

import {
  cardUploadRateLimited,
  discordRateLimited,
  publicReadRateLimited,
  WINDOW_MS,
  walletLinkRateLimited,
  wocBalanceRateLimited,
} from '../../ratelimit';
import { HttpError } from '../errors';
import type { Ctx, Middleware, Next } from '../types';

/** How a policy derives its rate-limit key: per client IP, or per (IP AND account). */
export type RateLimitKeyClass = 'ip' | 'ip+account';

/** A named rate-limit policy: which limiter to run and the Retry-After it reports. */
export interface RateLimitPolicy {
  readonly name: string;
  readonly keyClass: RateLimitKeyClass;
  readonly limited: (ctx: Ctx) => boolean;
  readonly retryAfterSeconds: number;
}

/**
 * Build the rate-limit middleware for `policy`. Throws HttpError(429,
 * 'rate_limit.exceeded', { retryAfterSeconds }) when policy.limited(ctx) is
 * true, else calls next().
 */
export function rateLimit(policy: RateLimitPolicy): Middleware {
  return async (ctx: Ctx, next: Next) => {
    if (policy.limited(ctx)) {
      throw new HttpError(429, 'rate_limit.exceeded', {
        retryAfterSeconds: policy.retryAfterSeconds,
      });
    }
    await next();
  };
}

// Every policy's Retry-After is the shared sliding-window size, in seconds.
const RETRY_AFTER_SECONDS = WINDOW_MS / 1000;

/**
 * An 'ip+account' policy must run AFTER requireAccount has populated
 * ctx.account. A missing account there is a composition bug (the policy was
 * mounted ahead of auth), not a client error, so it maps to a 500.
 */
function accountIdOf(ctx: Ctx): number {
  const id = ctx.account?.accountId;
  if (id === undefined) throw new HttpError(500, 'internal.error');
  return id;
}

export const PUBLIC_READ_POLICY: RateLimitPolicy = {
  name: 'public_read',
  keyClass: 'ip',
  limited: (ctx) => publicReadRateLimited(ctx.req),
  retryAfterSeconds: RETRY_AFTER_SECONDS,
};

export const WOC_BALANCE_POLICY: RateLimitPolicy = {
  name: 'woc_balance',
  keyClass: 'ip',
  limited: (ctx) => wocBalanceRateLimited(ctx.req),
  retryAfterSeconds: RETRY_AFTER_SECONDS,
};

export const CARD_UPLOAD_POLICY: RateLimitPolicy = {
  name: 'card_upload',
  keyClass: 'ip+account',
  limited: (ctx) => cardUploadRateLimited(ctx.req, accountIdOf(ctx)),
  retryAfterSeconds: RETRY_AFTER_SECONDS,
};

export const WALLET_LINK_POLICY: RateLimitPolicy = {
  name: 'wallet_link',
  keyClass: 'ip+account',
  limited: (ctx) => walletLinkRateLimited(ctx.req, accountIdOf(ctx)),
  retryAfterSeconds: RETRY_AFTER_SECONDS,
};

// AUTHENTICATED Discord legs only (link / status / reward). It requires
// ctx.account (accountIdOf 500s without it), so Phase 9 must mount it BEHIND
// requireAccount. The UNAUTHENTICATED start/callback legs run the same underlying
// limiter IP-only via discordRateLimited(req, 0) (ratelimit.ts keys on IP when
// accountId is 0); they need a SEPARATE 'ip' policy in Phase 9, not this one.
export const DISCORD_POLICY: RateLimitPolicy = {
  name: 'discord',
  keyClass: 'ip+account',
  limited: (ctx) => discordRateLimited(ctx.req, accountIdOf(ctx)),
  retryAfterSeconds: RETRY_AFTER_SECONDS,
};
