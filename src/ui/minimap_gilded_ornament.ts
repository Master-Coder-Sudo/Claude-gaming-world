// Hand-gilded ring for the circular minimap disc. Reuses the vocabulary built
// for the Performance Overlay's gilded frame (#2196, src/ui/perf_ornament_svg.ts)
// rather than inventing a second implementation: `perfGiltGradientBackground()`
// as-is for the ring's base hand-applied, uneven TONE (varies by ANGLE), plus
// the same seeded `mulberry32` PRNG and polar helpers that file exports, reused
// here to scatter a field of tiny gold speckles across the ring (varies by
// POSITION). A circular disc needs none of that window's rectangular
// corner/edge SVG masks: the whole ring is one `::before` sized a few px larger
// than the canvas, painted behind it (z-index: -1, see hud.css "minimap"
// section), so the canvas's own fully opaque pixels cover the center and only
// the extra outer band ever reads as the ring.
//
// The speckle SVG is a real colored image, not a colorless mask like this
// file's other consumers: hand-gilded gold leaf reads as multi-toned because
// countless individual flecks each catch light a little differently, which a
// single colorless mask (one shape, one CSS `background` color) cannot
// express. Baking resolved --color-gold-* values into each speckle's `fill`
// is safe here specifically because that ramp is a static, non-themed design
// constant (tokens.css: "purely additive... never retunes an existing
// consumer"), and this function re-resolves it fresh every time it runs (once
// at boot, same as perfGiltGradientBackground()), so a future ramp retune
// still repaints correctly on the next boot.
import { mulberry32, perfGiltGradientBackground, polarX, polarY } from './perf_ornament_svg';

const SPECKLE_VIEWBOX = 200;
const SPECKLE_SEED = 91501;
const SPECKLE_COUNT = 320;
// Normalized radii (of a viewBox where 100 is the ring's own edge): only the
// outer band ever shows (the canvas covers the rest), so speckles concentrate
// there. A little inside that visible band is kept for safety margin against
// small changes to the ring's CSS `inset`.
const SPECKLE_R_MIN = 76;
const SPECKLE_R_MAX = 100;
const GOLD_STEPS = [300, 400, 500, 600, 700, 800, 900];

function resolveGoldTones(root: HTMLElement): string[] {
  const style = getComputedStyle(root);
  const tones = GOLD_STEPS.map((step) =>
    style.getPropertyValue(`--color-gold-${step}`).trim(),
  ).filter(Boolean);
  // A detached/test root (or a real root read before tokens.css applied) has
  // no computed --color-gold-* values: fall back to a single neutral gold so
  // the generated SVG still has a paintable fill rather than an empty string.
  return tones.length > 0 ? tones : ['#bc8732'];
}

/**
 * A field of tiny gold speckles scattered across the ring's visible outer
 * band: most are small and low-opacity (the bulk of a hand-gilded surface's
 * subtle grain), a minority are larger/brighter (the occasional fleck that
 * catches the light), matching real gold leaf's uneven, multi-toned texture
 * rather than one flat painted band.
 */
export function minimapGiltSpeckleBackground(root: HTMLElement = document.documentElement): string {
  const tones = resolveGoldTones(root);
  const rand = mulberry32(SPECKLE_SEED);
  const cx = SPECKLE_VIEWBOX / 2;
  const cy = SPECKLE_VIEWBOX / 2;
  const circles: string[] = [];
  for (let i = 0; i < SPECKLE_COUNT; i++) {
    const deg = rand() * 360;
    const r = SPECKLE_R_MIN + rand() * (SPECKLE_R_MAX - SPECKLE_R_MIN);
    const x = polarX(cx, r, deg);
    const y = polarY(cy, r, deg);
    // Squaring biases toward small radii most of the time, with an occasional
    // larger fleck breaking through: the same "mostly small, rarely large"
    // distribution real hammered/hand-applied gold leaf shows.
    const radius = 0.6 + rand() * rand() * 3.2;
    const tone = tones[Math.floor(rand() * tones.length)];
    const opacity = (0.55 + rand() * 0.45).toFixed(2);
    circles.push(
      `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${radius.toFixed(2)}" fill="${tone}" fill-opacity="${opacity}"/>`,
    );
  }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${SPECKLE_VIEWBOX} ${SPECKLE_VIEWBOX}'>${circles.join('')}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * Sets the `--minimap-gilt` / `--minimap-speckle` custom properties
 * `#minimap-disc::before` (hud.css) consumes. Called once at game boot
 * (main.ts, next to `applyPerfOrnamentVars()`); both values are static per
 * boot, so this never needs to re-run on a theme switch.
 */
export function applyMinimapOrnamentVars(root: HTMLElement = document.documentElement): void {
  root.style.setProperty('--minimap-gilt', perfGiltGradientBackground());
  root.style.setProperty('--minimap-speckle', minimapGiltSpeckleBackground(root));
}
