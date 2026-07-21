// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyMinimapOrnamentVars,
  minimapGiltSpeckleBackground,
} from '../src/ui/minimap_gilded_ornament';
import { perfGiltGradientBackground } from '../src/ui/perf_ornament_svg';

const GOLD_TOKENS: Record<string, string> = {
  '--color-gold-300': '#ffe5a3',
  '--color-gold-400': '#f0c86d',
  '--color-gold-500': '#d8a645',
  '--color-gold-600': '#bc8732',
  '--color-gold-700': '#926321',
  '--color-gold-800': '#6b4517',
  '--color-gold-900': '#4a2f10',
};

function decodeSvg(dataUri: string): string {
  const match = dataUri.match(/^url\("data:image\/svg\+xml,(.*)"\)$/);
  expect(match).not.toBeNull();
  return decodeURIComponent(match?.[1] ?? '');
}

describe('minimap_gilded_ornament', () => {
  beforeEach(() => {
    for (const [prop, value] of Object.entries(GOLD_TOKENS)) {
      document.documentElement.style.setProperty(prop, value);
    }
  });

  it('writes --minimap-gilt to a paintable background value', () => {
    applyMinimapOrnamentVars(document.documentElement);
    const value = document.documentElement.style.getPropertyValue('--minimap-gilt');
    expect(value).toMatch(/^repeating-conic-gradient\(/);
  });

  it('reuses the exact perf-ornament gilt generator rather than a second implementation', () => {
    applyMinimapOrnamentVars(document.documentElement);
    const value = document.documentElement.style.getPropertyValue('--minimap-gilt');
    expect(value).toBe(perfGiltGradientBackground());
  });

  it('writes --minimap-speckle to an svg data-uri background image', () => {
    applyMinimapOrnamentVars(document.documentElement);
    const value = document.documentElement.style.getPropertyValue('--minimap-speckle');
    expect(value).toMatch(/^url\("data:image\/svg\+xml,/);
  });

  it('the speckle field is a real field of many distinct circles, not one flat shape', () => {
    const svg = decodeSvg(minimapGiltSpeckleBackground(document.documentElement));
    const circles = svg.match(/<circle/g) ?? [];
    expect(circles.length).toBeGreaterThan(100);
  });

  it('speckle fill colors are drawn from the resolved --color-gold-* tokens, not hardcoded', () => {
    const svg = decodeSvg(minimapGiltSpeckleBackground(document.documentElement));
    const fills = new Set(
      (svg.match(/fill="(#[0-9a-fA-F]{6})"/g) ?? []).map((m) => m.slice(6, -1)),
    );
    expect(fills.size).toBeGreaterThan(1);
    for (const fill of fills) {
      expect(Object.values(GOLD_TOKENS)).toContain(fill);
    }
  });

  it('speckles vary in size and opacity rather than being uniform dots', () => {
    const svg = decodeSvg(minimapGiltSpeckleBackground(document.documentElement));
    const radii = new Set(svg.match(/ r="([\d.]+)"/g));
    const opacities = new Set(svg.match(/fill-opacity="([\d.]+)"/g));
    expect(radii.size).toBeGreaterThan(5);
    expect(opacities.size).toBeGreaterThan(5);
  });

  it('is deterministic: same tokens produce byte-identical speckle output', () => {
    expect(minimapGiltSpeckleBackground(document.documentElement)).toBe(
      minimapGiltSpeckleBackground(document.documentElement),
    );
  });

  it('falls back to a single paintable tone when no gold tokens are resolvable', () => {
    const detached = document.createElement('div');
    const svg = decodeSvg(minimapGiltSpeckleBackground(detached));
    expect(svg).toContain('<circle');
    expect(svg).toContain('#bc8732');
  });
});
