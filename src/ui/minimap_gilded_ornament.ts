// Hand-gilded ring for the circular minimap disc. Reuses the gilt-gradient
// generator built for the Performance Overlay (#2196, src/ui/perf_ornament_svg.ts)
// AS-IS: never a second gradient implementation, just a second consumer. Unlike
// that window's rectangular corner/edge SVG masks (needed for straight edges and
// corner flourishes), a circular disc needs no mask geometry at all: the ring is
// a `::before` sized a few px larger than the canvas, painted behind it
// (z-index: -1, see hud.css "minimap" section), so the canvas's own fully opaque
// pixels cover the center and only the extra outer band reads as the ring.
import { perfGiltGradientBackground } from './perf_ornament_svg';

/**
 * Sets `--minimap-gilt`, the custom property `#minimap-disc::before` (hud.css)
 * consumes. Called once at game boot (main.ts, next to `applyPerfOrnamentVars()`);
 * the gradient is static, so this never needs to re-run on a theme switch.
 */
export function applyMinimapOrnamentVars(root: HTMLElement = document.documentElement): void {
  root.style.setProperty('--minimap-gilt', perfGiltGradientBackground());
}
