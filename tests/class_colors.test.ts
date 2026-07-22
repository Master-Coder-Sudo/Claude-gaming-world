import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLASS_CHIPS } from '../src/guide/data';
import { CLASSES } from '../src/sim/content/classes';
import type { PlayerClass } from '../src/sim/types';

// The class color lives in three places: CLASSES[cls].color (the shared source,
// driving chat names, party/raid frame accents, minimap/delve dots, the 3D model
// tint, and the Player Card), the two --class-color token blocks in shell.css
// (char-select chips, class detail panels, skin swatches), and the guide's
// CLASS_CHIPS. The CSS and guide copies are MANUAL parallels that do not read
// CLASSES, and they have drifted before (priest was #ffffff vs #fffff0), so this
// suite pins the shared palette to literals and guards all three sites against
// each other.

// The approved palette, pinned as literals so a silent revert of any single
// color fails loudly. Do not derive these from CLASSES: the pin IS the spec.
const PALETTE: Record<PlayerClass, number> = {
  warrior: 0xbd6448,
  mage: 0x33c1f1,
  rogue: 0xfcee58,
  paladin: 0xf26fae,
  hunter: 0xa6d84f,
  priest: 0xc6d4f0,
  shaman: 0x4e8aea,
  warlock: 0xa785e6,
  druid: 0xff6a1f,
};
const CLASS_IDS = Object.keys(PALETTE) as PlayerClass[];

const toCssHex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

// Whitespace-normalized view of the CSS so biome re-wrapping never breaks a
// match, only a real value change does (the known pin trap).
const shellCss = readFileSync(new URL('../src/styles/shell.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');

describe('class color palette', () => {
  it('CLASSES pins the nine approved colors as exact literals', () => {
    for (const cls of CLASS_IDS) {
      expect(CLASSES[cls].color, cls).toBe(PALETTE[cls]);
    }
  });

  it('covers every class exactly once', () => {
    expect(CLASS_IDS.sort()).toEqual(Object.keys(CLASSES).sort());
  });

  it('both shell.css --class-color token blocks match the shared value per class', () => {
    for (const cls of CLASS_IDS) {
      // Matches any selector block containing data-class="<cls>" that declares
      // --class-color; there are two (the .mini-class copy and the generic
      // [data-class] copy) and BOTH must agree with CLASSES[cls].color.
      const re = new RegExp(
        `\\[data-class="${cls}"\\] \\{[^}]*?--class-color: (#[0-9a-fA-F]{6})`,
        'g',
      );
      const tokens = [...shellCss.matchAll(re)].map((m) => m[1].toLowerCase());
      expect(tokens, `shell.css --class-color blocks for ${cls}`).toEqual([
        toCssHex(PALETTE[cls]),
        toCssHex(PALETTE[cls]),
      ]);
    }
  });

  it('the guide CLASS_CHIPS colors match the shared value per class', () => {
    expect(CLASS_CHIPS.map((c) => c.id).sort()).toEqual([...CLASS_IDS].sort());
    for (const chip of CLASS_CHIPS) {
      expect(chip.color.toLowerCase(), `guide color for ${chip.id}`).toBe(
        toCssHex(PALETTE[chip.id as PlayerClass]),
      );
    }
  });
});
