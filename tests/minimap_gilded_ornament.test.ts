import { describe, expect, it } from 'vitest';
import { applyMinimapOrnamentVars } from '../src/ui/minimap_gilded_ornament';
import { perfGiltGradientBackground } from '../src/ui/perf_ornament_svg';

describe('minimap_gilded_ornament', () => {
  it('writes --minimap-gilt to a paintable background value', () => {
    const written: Record<string, string> = {};
    const fakeRoot = {
      style: {
        setProperty: (prop: string, value: string) => {
          written[prop] = value;
        },
      },
    } as unknown as HTMLElement;
    applyMinimapOrnamentVars(fakeRoot);
    expect(written['--minimap-gilt']).toMatch(/^repeating-conic-gradient\(/);
  });

  it('reuses the exact perf-ornament gilt generator rather than a second implementation', () => {
    const written: Record<string, string> = {};
    const fakeRoot = {
      style: {
        setProperty: (prop: string, value: string) => {
          written[prop] = value;
        },
      },
    } as unknown as HTMLElement;
    applyMinimapOrnamentVars(fakeRoot);
    expect(written['--minimap-gilt']).toBe(perfGiltGradientBackground());
  });
});
