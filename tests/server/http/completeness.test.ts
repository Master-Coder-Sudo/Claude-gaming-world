// Registry-completeness gate for the Phase 9 API pipeline (docs/api-pipeline/).
//
// The Phase 9 dispatcher (server/http/dispatch.ts) places the new route registry
// in FRONT of the legacy /api handleApi ladder: for a path the registry OWNS (a
// matched RouteDef) it runs the onion; for ANY OTHER /api path it delegates to
// the legacy handleApi UNCHANGED. So the dispatcher's real coverage is
//   (router-owned paths) UNION (paths the legacy handler still serves).
//
// This gate HARD-FAILS if any legacy /api ladder path (from the Phase 3 surface
// inventory) would be served by NEITHER the new router NOR the legacy delegate: a
// dropped route is a production 404. It stays meaningful as routes migrate,
// because each route moves from delegate-covered to router-owned and coverage is
// checked against BOTH arms, so a migration that adds a router route without
// removing the legacy arm (double-serving) or removes the legacy arm without a
// matching router route (a gap) is caught here.
//
// The coverage decision is factored into a pure isCovered() helper, and a
// negative-control block feeds it a synthetic dropped route to prove the gate is
// NON-VACUOUS (it can actually fail). The legacy-served set is re-derived
// independently from server/main.ts SOURCE (the same extraction technique as
// surface_inventory.test.ts, read as a file, never imported), which gives the
// gate teeth against a future dropped dispatch arm.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type ApiRegistry,
  apiRegistry,
  apiRoutes,
  assertNoOwnedRouteShadowing,
  createApiRegistry,
} from '../../../server/http/registry';
import { checkRequireOwnedCoverage, checkRouteCompleteness } from '../helpers';
import { DEVIATION_ID, KNOWN_DEVIATIONS } from './known_deviations';
import { DISPATCH, SURFACE_INVENTORY } from './surface_inventory';

// The minimal route shape the coverage helpers need: a method, a path, and (for a
// legacy :param route) the exact dispatcher regex whose source keys it in the
// legacy-served set. A SurfaceRoute satisfies this structurally, so the inventory
// rows pass straight through and a synthetic route (the negative control) is
// trivial to build.
interface LadderRoute {
  readonly method: string;
  readonly path: string;
  readonly match?: RegExp;
}

// -------------------------------------------------------------------------
// Coverage helpers (pure, inspectable): router-owned OR legacy-served.
// -------------------------------------------------------------------------

// Substitute each :param segment with a literal placeholder so resolve(), which
// matches CONCRETE paths, can be queried against a :param ladder pattern. A
// placeholder segment matches the router's ':param' (any non-empty segment) and
// never collides with a static segment.
function concretePath(path: string): string {
  return path
    .split('/')
    .map((segment) => (segment.startsWith(':') ? 'x' : segment))
    .join('/');
}

// True when the NEW registry owns the route (the dispatcher would run the onion).
function isRouterOwned(registry: ApiRegistry, route: LadderRoute): boolean {
  return registry.resolve(route.method, concretePath(route.path)).kind === 'matched';
}

// The key a ladder route carries in the legacy-served set: the exact dispatcher
// regex source for a :param route, else the literal path for an exact arm.
function legacyKey(route: LadderRoute): string {
  return route.match ? route.match.source : route.path;
}

// True when the legacy handler still serves the route (its key is in the set
// re-derived from main.ts source). The dispatcher delegates every non-owned /api
// path to the legacy ladder, but that only yields a real response if the arm is
// still present; a dropped arm answers 404, i.e. NOT served.
function legacyServes(route: LadderRoute, legacyServed: ReadonlySet<string>): boolean {
  return legacyServed.has(legacyKey(route));
}

// The coverage decision the gate turns on: a ladder path is covered iff the new
// router owns it OR the legacy handler still serves it. Neither means a prod 404.
function isCovered(
  route: LadderRoute,
  registry: ApiRegistry,
  legacyServed: ReadonlySet<string>,
): boolean {
  return isRouterOwned(registry, route) || legacyServes(route, legacyServed);
}

// -------------------------------------------------------------------------
// The legacy /api ladder (must-serve set) and the source-derived served set.
// -------------------------------------------------------------------------

// The swag-claim orphan is an unreachable handler with no dispatch arm today (see
// the swagClaimOrphanUnreachable known deviation), so it is intentionally NOT
// served and is excluded from the must-serve set. Referencing the deviation keeps
// the exclusion documented, not silent.
const ORPHAN_DEVIATION = KNOWN_DEVIATIONS.find(
  (d) => d.id === DEVIATION_ID.swagClaimOrphanUnreachable,
);
const EXCLUDED_PATHS = new Set<string>(ORPHAN_DEVIATION?.routes ?? []);

// Every legacy /api ladder row (dispatcher === main handleApi), minus the
// documented unreachable orphan.
const legacyLadder = SURFACE_INVENTORY.filter(
  (r) => r.dispatcher === DISPATCH.mainApi && !EXCLUDED_PATHS.has(r.path),
);

// Read main.ts as a FILE (never import: main constructs a pg pool at load) and
// re-derive the set of /api paths the CURRENT handleApi still serves.
const MAIN_SOURCE_URL = new URL('../../../server/main.ts', import.meta.url);

// Every `=== '<path>'` (or "<path>") comparison whose path begins with /api/. The
// quote is captured so the same quote closes it.
const EXACT_API_RE = /===\s*(['"])(\/api\/[^'"]*)\1/g;

// Every `const <name>Match = /<regex>/.exec(...)`. Group 2 is the regex source
// body (slash-escaped exactly as RegExp.source reports it); `(?:\\.|[^/\\\n])*`
// consumes escaped chars and stops at the first unescaped closing slash.
const PARAM_API_RE = /const\s+(\w*Match)\s*=\s*\/((?:\\.|[^/\\\n])*)\/[a-z]*\.exec/g;

// The regex-source prefix a main.ts /api :param route must start with.
const API_REGEX_PREFIX = '^\\/api\\/';

function deriveLegacyServed(): Set<string> {
  const text = readFileSync(MAIN_SOURCE_URL, 'utf8');
  const served = new Set<string>();
  for (const m of text.matchAll(EXACT_API_RE)) served.add(m[2]);
  for (const m of text.matchAll(PARAM_API_RE)) {
    const body = m[2];
    if (body.startsWith(API_REGEX_PREFIX)) served.add(body);
  }
  return served;
}

const legacyServed = deriveLegacyServed();

describe('registry completeness: the legacy /api ladder is fully covered', () => {
  it('derives a non-empty legacy ladder and a non-empty source-served set', () => {
    // Guard against a vacuous pass: both the inventory ladder and the independent
    // source scan must actually find routes.
    expect(legacyLadder.length).toBeGreaterThan(50);
    expect(legacyServed.size).toBeGreaterThan(40);
  });

  it('covers every ladder path by the router OR the delegate (no dropped route)', () => {
    const uncovered = legacyLadder
      .filter((r) => !isCovered(r, apiRegistry, legacyServed))
      .map((r) => `${r.method} ${r.path}`);
    expect(uncovered).toEqual([]);
  });

  it('never double-serves: no ladder path is both router-owned and legacy-served', () => {
    // A migration that adds a route to the registry MUST remove its legacy arm.
    // Empty this phase, but a real guard for the migration phases (Phase 10 on).
    const doubleServed = legacyLadder
      .filter((r) => isRouterOwned(apiRegistry, r) && legacyServes(r, legacyServed))
      .map((r) => `${r.method} ${r.path}`);
    expect(doubleServed).toEqual([]);
  });
});

describe('registry completeness: this-phase seed baseline', () => {
  it('ships an empty registry so every ladder path resolves to a non-matched kind', () => {
    expect(apiRoutes).toHaveLength(0);
    for (const r of legacyLadder) {
      expect(apiRegistry.resolve(r.method, concretePath(r.path)).kind).not.toBe('matched');
    }
  });

  it('is 100% delegate-served and 0% router-owned, and the union covers the ladder', () => {
    const routerOwned = legacyLadder.filter((r) => isRouterOwned(apiRegistry, r));
    const delegateServed = legacyLadder.filter((r) => legacyServes(r, legacyServed));
    // Pre-migration: the registry owns nothing, so every ladder path is served by
    // the legacy delegate.
    expect(routerOwned).toEqual([]);
    expect(delegateServed.length).toBe(legacyLadder.length);
    // Union (router-owned UNION delegate-served) covers the full ladder, no gap.
    const covered = legacyLadder.filter((r) => isCovered(r, apiRegistry, legacyServed));
    expect(covered.length).toBe(legacyLadder.length);
  });

  it('excludes the documented unreachable swag-claim orphan from the must-serve set', () => {
    expect(ORPHAN_DEVIATION).toBeDefined();
    expect(ORPHAN_DEVIATION?.routes).toContain('/api/discord/swag/claim');
    const orphanRow = SURFACE_INVENTORY.find((r) => r.path === '/api/discord/swag/claim');
    expect(orphanRow?.unreachable).toBe(true);
    expect(orphanRow?.dispatcher).toBe(DISPATCH.mainApi);
    expect(legacyLadder.some((r) => r.path === '/api/discord/swag/claim')).toBe(false);
    // The source does not serve it either, so including it in the must-serve set
    // would (correctly) fail the coverage gate; the exclusion is what keeps the
    // gate honest rather than red on a by-design orphan.
    expect(legacyServes({ method: 'POST', path: '/api/discord/swag/claim' }, legacyServed)).toBe(
      false,
    );
  });
});

describe('registry completeness: the gate is non-vacuous (negative control)', () => {
  it('reports a synthetic dropped route as NOT covered', () => {
    // A path that is neither router-owned (empty registry) nor legacy-served: the
    // exact shape of a route silently dropped during a migration.
    const droppedRoute: LadderRoute = {
      method: 'GET',
      path: '/api/__dropped-route-never-served__',
    };
    expect(isRouterOwned(apiRegistry, droppedRoute)).toBe(false);
    expect(legacyServes(droppedRoute, legacyServed)).toBe(false);
    expect(isCovered(droppedRoute, apiRegistry, legacyServed)).toBe(false);

    // And the aggregate gate would FAIL for it: added to the ladder, it lands in
    // the uncovered list.
    const withDropped: LadderRoute[] = [...legacyLadder, droppedRoute];
    const uncovered = withDropped
      .filter((r) => !isCovered(r, apiRegistry, legacyServed))
      .map((r) => r.path);
    expect(uncovered).toContain('/api/__dropped-route-never-served__');
  });

  it('reports a real ladder path as covered via the legacy delegate arm', () => {
    // Positive contrast: a genuine ladder route is covered even with an empty
    // registry, through the legacy-served arm. Proves isCovered is not stuck-false.
    const served = legacyLadder.find((r) => legacyServes(r, legacyServed));
    expect(served).toBeDefined();
    if (served) expect(isCovered(served, apiRegistry, legacyServed)).toBe(true);
  });

  it('reports a route as covered via the router arm even with an empty legacy set', () => {
    // Forward-looking: once a route migrates into the registry, the router arm of
    // isCovered carries it even if the legacy arm is gone. Proves that arm is real.
    const ownedRegistry = createApiRegistry([
      { method: 'GET', path: '/api/owned/thing', surface: 'api', handler: async () => {} },
    ]);
    const ownedLadderRoute: LadderRoute = { method: 'GET', path: '/api/owned/thing' };
    expect(isRouterOwned(ownedRegistry, ownedLadderRoute)).toBe(true);
    expect(isCovered(ownedLadderRoute, ownedRegistry, new Set())).toBe(true);
  });
});

describe('registry self-consistency (vacuous now, forward-real)', () => {
  it('every registered route is complete (method, path, handler)', () => {
    expect(checkRouteCompleteness([...apiRoutes])).toEqual([]);
  });

  it('every account-owned :id route carries a requireOwned loader', () => {
    expect(checkRequireOwnedCoverage([...apiRoutes])).toEqual([]);
  });

  it('no account-owned route is shadowed by an earlier non-owned catch-all', () => {
    expect(() => assertNoOwnedRouteShadowing([...apiRoutes])).not.toThrow();
  });
});
