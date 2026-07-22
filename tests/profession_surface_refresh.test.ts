import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { professionSurfaceRefreshSig } from '../src/ui/profession_identity_view';
import type { CraftingIdentityView } from '../src/world_api/professions';

function identity(overrides: Partial<CraftingIdentityView> = {}): CraftingIdentityView {
  return {
    version: 1,
    synced: true,
    craftSkills: { weaponcrafting: 75, armorcrafting: 50 },
    activeArchetype: 'weaponcrafting',
    pairedMajor: 'armorcrafting',
    hobbyCraft: 'jewelcrafting',
    attunedPairs: ['weaponcrafting+armorcrafting', 'engineering+alchemy'],
    switchCount: 0,
    amendsProgress: 0,
    amendsRequired: 5,
    knownRecipes: ['copper_sword', 'iron_helm'],
    ...overrides,
  };
}

describe('professionSurfaceRefreshSig', () => {
  it('is stable for equivalent set and record ordering', () => {
    const a = identity();
    const b = identity({
      craftSkills: { armorcrafting: 50, weaponcrafting: 75 },
      attunedPairs: ['engineering+alchemy', 'weaponcrafting+armorcrafting'],
      knownRecipes: ['iron_helm', 'copper_sword'],
    });
    expect(professionSurfaceRefreshSig(b)).toBe(professionSurfaceRefreshSig(a));
  });

  it('moves for every identity dimension painted by Character or Crafting', () => {
    const base = identity();
    const baseSig = professionSurfaceRefreshSig(base);
    const changed = [
      identity({ synced: false }),
      identity({ activeArchetype: 'engineering' }),
      identity({ pairedMajor: 'alchemy' }),
      identity({ hobbyCraft: 'cooking' }),
      identity({ attunedPairs: ['weaponcrafting+armorcrafting'] }),
      identity({ switchCount: 1 }),
      identity({ amendsProgress: 1 }),
      identity({ amendsRequired: 8 }),
      identity({ craftSkills: { weaponcrafting: 76, armorcrafting: 50 } }),
      identity({ knownRecipes: ['copper_sword', 'iron_helm', 'silver_ring'] }),
    ];
    expect(changed.map(professionSurfaceRefreshSig)).not.toContain(baseSig);
  });

  it('detects the delayed online snapshot rather than the preceding stale event state', () => {
    const stale = identity();
    let last = professionSurfaceRefreshSig(stale);
    const changed = (next: CraftingIdentityView): boolean => {
      const sig = professionSurfaceRefreshSig(next);
      if (sig === last) return false;
      last = sig;
      return true;
    };

    // An attuned event can drain before cprof. The stale mirror does not claim
    // a repaint edge; the later snapshot does, and subsequent polls elide.
    expect(changed(stale)).toBe(false);
    const returned = identity({
      activeArchetype: 'engineering',
      pairedMajor: 'alchemy',
      hobbyCraft: 'cooking',
      attunedPairs: ['weaponcrafting+armorcrafting', 'engineering+alchemy'],
      switchCount: 1,
    });
    expect(changed(returned)).toBe(true);
    expect(changed(returned)).toBe(false);
  });
});

describe('Hud profession-surface convergence wiring', () => {
  const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
  const methodStart = hud.indexOf('private refreshOpenProfessionSurfacesIfChanged(): void');
  const method = hud.slice(methodStart, hud.indexOf('\n  }', methodStart) + 4);

  it('refreshes both cold surfaces from the identity signature on the slow band', () => {
    expect(hud).toContain('if (slowHud) this.refreshOpenProfessionSurfacesIfChanged();');
    expect(method).toContain('professionSurfaceRefreshSig(this.sim.craftingIdentity)');
    expect(method).toContain('this.charWindow.renderIfOpen()');
    expect(method).toContain("$('#crafting-window').style.display === 'block'");
    expect(method).toContain('this.renderCrafting()');
  });

  it('also probes immediately for a personal attunement without wiring the bystander arm', () => {
    const personalStart = hud.indexOf("case 'attunement': {");
    const personal = hud.slice(personalStart, hud.indexOf('\n      }', personalStart));
    const bystanderStart = hud.indexOf("case 'attunedZone':");
    const bystander = hud.slice(bystanderStart, hud.indexOf('break;', bystanderStart));
    expect(personal).toContain('this.refreshOpenProfessionSurfacesIfChanged()');
    expect(bystander).not.toContain('this.refreshOpenProfessionSurfacesIfChanged()');
  });
});
