import { describe, expect, it } from 'vitest';
import { _resetTerrainHeightCache, terrainHeight } from '../src/sim/world';

// terrainHeight caches FBM samples for the renderer's repeated grid queries, but it
// MUST stay a pure function of (x, z, seed): the sim (ground clamp), the renderer
// (mesh), and every host have to agree bit-for-bit for the same seed. A cache keyed on
// a rounded (e.g. cm) bucket would return whichever caller's EXACT coordinate populated
// the bucket first, so a renderer-present browser and a renderer-absent server could
// clamp ground to different heights. These tests pin the purity the exact-key cache
// restores.
describe('terrainHeight cache is a pure function of (x, z, seed)', () => {
  const seed = 4242;
  // A sloped rim-wall location where the heightfield genuinely varies over a few mm, so
  // a bucket collision would be observable (two nearby points differ in true height).
  const x = 315.0;
  const z = 40.0;
  const neighborDx = 0.004; // < 0.5 cm: lands in the SAME cm bucket the old key rounded to

  it('returns a value independent of which nearby coordinate was queried first', () => {
    _resetTerrainHeightCache();
    const solo = terrainHeight(x, z, seed);

    // Query a sub-cm neighbor FIRST (as the renderer would when meshing), then the
    // original point. With a rounded key the neighbor would have populated the shared
    // bucket and the original would wrongly echo the neighbor's height.
    _resetTerrainHeightCache();
    terrainHeight(x + neighborDx, z + neighborDx, seed);
    const afterNeighbor = terrainHeight(x, z, seed);

    expect(afterNeighbor).toBe(solo);
  });

  it('distinguishes two sub-cm-apart coordinates instead of collapsing them', () => {
    _resetTerrainHeightCache();
    const a = terrainHeight(x, z, seed);
    const b = terrainHeight(x + neighborDx, z + neighborDx, seed);
    // Distinct exact inputs on a slope resolve to distinct heights; a rounded key would
    // have collapsed b onto a's cached value.
    expect(b).not.toBe(a);
  });

  it('is unaffected by cache eviction (recompute yields the identical value)', () => {
    _resetTerrainHeightCache();
    const first = terrainHeight(x, z, seed);
    // Flood the cache past its cap so (x, z, seed) is evicted, then re-query.
    for (let i = 0; i < 5000; i++) terrainHeight(1000 + i, 2000 + i, seed);
    const afterEviction = terrainHeight(x, z, seed);
    expect(afterEviction).toBe(first);
  });
});
