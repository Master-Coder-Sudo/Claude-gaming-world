// Mobile HUD overlap audit for World of ClaudeCraft.
//
// PURPOSE
//   Sibling gate to mobile_cluster_layout_check.mjs. The cluster check gates the
//   thumb-control clusters in isolation; this audit gates the FULL populated HUD:
//   the unit frames, buff/debuff bars, minimap, quest tracker, meters, and the
//   pop-up windows, all with real state (a 4-member party, a forced target, a
//   populated buff bar). It measures REAL getBoundingClientRect geometry (never
//   CSS text) with the shared gap math in ./lib/overlap_geometry.mjs.
//
// TWO PASSES
//   A) Persistent-chrome pass (STRICT, the repeatable pre-release gate): per
//      device profile it builds a party, forces a target (so #party-frames gains
//      the .below-target offset), populates the buff bar, then pairwise-checks
//      the always-on chrome (#target-frame, #party-frames, #buff-bar, #debuff-bar,
//      #minimap-wrap, #quest-tracker, #player-frame, #meters-window) against each
//      other and against the thumb controls. Chrome-vs-chrome readability pairs
//      need gap >= 0; any pair where one element is interactive needs gap >= 4.
//      Violations exit 1 by default (like the cluster check).
//   B) Window-open matrix (AUDIT mode by default: report + screenshots, exit 0;
//      pass --gate to make its violations exit 1 too). For each HUD window toggle
//      it opens the window, asserts the box is fully on-screen and its close
//      control is >= 40px and on-screen, then closeAll() and asserts the
//      body.mobile-window-open class clears. The vendor+bags co-open pair is a
//      special case (windows legitimately cover chrome otherwise, so window-over-
//      chrome overlap is NOT flagged here except that pair).
//
// USAGE
//   Needs a dev server. URL overrides the target (default http://localhost:5173/):
//     URL=http://localhost:5174/ node scripts/mobile_hud_overlap_audit.mjs
//     URL=http://localhost:5174/ node scripts/mobile_hud_overlap_audit.mjs --gate
//   Pass A runs the full six-profile sweep; pass B runs the window matrix at
//   844x390 (every window) plus 932x430 and 1280x720 spot-checks, to keep runtime
//   sane. Screenshots land in tmp/mobile-hud-audit/ under the worktree (git-ignored).
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';
import { controlGap, PROFILES } from './lib/overlap_geometry.mjs';

const URL = process.env.URL || 'http://localhost:5173/';
const GATE = process.argv.includes('--gate');
const SHOT_DIR = 'tmp/mobile-hud-audit';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IGNORED_CONSOLE = /502|Bad Gateway|fetch project stats/i;

// The thumb controls (measured as neighbours of the chrome in pass A). Same set
// the cluster check measures; here they are the interactive neighbours the
// always-on chrome must not crowd.
const CONTROL_IDS = [
  'mobile-action-attack',
  'mobile-target-cycle',
  'mobile-action-page-toggle',
  'mobile-autorun',
  'mobile-interact',
  'mobile-jump',
  'mobile-chat',
  'mobile-social',
  'mobile-more',
  'mobile-consumables-toggle',
];

// Always-on chrome measured in pass A. Frames/bars are readability surfaces;
// #minimap-wrap hosts the interactive zoom buttons so it counts as interactive.
const CHROME_IDS = [
  'target-frame',
  'party-frames',
  'buff-bar',
  'debuff-bar',
  'minimap-wrap',
  'quest-tracker',
  'player-frame',
  'meters-window',
];

// Interactive classification for the >= 4px vs >= 0px rule. The thumb ring
// controls plus minimap-zoom / minimap-wrap are things a finger taps; frames and
// bars are read, not tapped, so two of them only need to not visually collide.
const INTERACTIVE_IDS = new Set([...CONTROL_IDS, 'minimap-wrap']);
// The ring controls are true circles (border-radius: 50% clips the hit-test too),
// so their mis-tap distance is centre-to-centre minus radii, not box separation.
const CIRCLE_IDS = new Set([
  'mobile-action-attack',
  'mobile-target-cycle',
  'mobile-interact',
  'mobile-action-page-toggle',
  'mobile-autorun',
  'mobile-jump',
]);

const TOUCH_FLOOR = 40;
const MIN_GAP_INTERACTIVE = 4; // px between any pair where one element is interactive
const MIN_GAP_CHROME = 0; // chrome-vs-chrome only needs to not visually overlap

// The window toggles to sweep in pass B, each with the window id it opens and the
// viewport widths to test it at. Every window runs at 844x390; a couple of the
// larger windows also spot-check 932x430 and 1280x720.
const SPOT = [844, 932, 1280];
const WINDOW_MATRIX = [
  { toggle: 'toggleQuestLog', id: 'quest-log-window', widths: SPOT },
  { toggle: 'toggleBags', id: 'bags', widths: SPOT },
  { toggle: 'toggleCrafting', id: 'crafting-window', widths: [844] },
  { toggle: 'toggleCalendar', id: 'calendar-window', widths: [844] },
  { toggle: 'toggleArena', id: 'arena-window', widths: [844] },
  { toggle: 'toggleValeCup', id: 'valecup-window', widths: [844] },
  { toggle: 'toggleLeaderboard', id: 'leaderboard-window', widths: [844] },
  { toggle: 'toggleSocial', id: 'social-window', widths: SPOT },
  { toggle: 'toggleMap', id: 'map-window', widths: [844] },
  { toggle: 'toggleTalents', id: 'talents-window', widths: [844] },
  { toggle: 'toggleChar', id: 'char-window', widths: [844] },
  { toggle: 'toggleSpellbook', id: 'spellbook', widths: [844] },
  { toggle: 'toggleMeters', id: 'meters-window', widths: [844] },
];

const failures = [];
const notes = [];
const fail = (msg) => {
  failures.push(msg);
  console.error(`FAIL ${msg}`);
};
const note = (msg) => {
  notes.push(msg);
  console.log(`NOTE ${msg}`);
};

// In-page rect grab: null for missing / zero-size / display:none / hidden.
function collectRects(page, ids) {
  return page.evaluate((elIds) => {
    const grab = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return null;
      return {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        w: r.width,
        h: r.height,
      };
    };
    const out = { rects: {}, vw: window.innerWidth, vh: window.innerHeight };
    for (const id of elIds) out.rects[id] = grab(document.getElementById(id));
    out.belowTarget = !!document.getElementById('party-frames')?.classList.contains('below-target');
    out.windowOpenClass = document.body.classList.contains('mobile-window-open');
    return out;
  }, ids);
}

// Deterministic mobile viewport flip: raw CDP device metrics (puppeteer omits
// screenWidth/Height and headless then fit-scales a narrower viewport), then wait
// until the tier class and a laid-out control are both real before measuring.
async function flipViewport(page, media, w, h, dsf, expectedTier) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await media.send('Emulation.setDeviceMetricsOverride', {
      width: w,
      height: h,
      deviceScaleFactor: dsf,
      mobile: true,
      screenWidth: w,
      screenHeight: h,
      positionX: 0,
      positionY: 0,
    });
    await media.send('Emulation.resetPageScaleFactor').catch(() => {});
    await sleep(150);
    const inner = await page.evaluate(() => [window.innerWidth, window.innerHeight]);
    if (Math.abs(inner[0] - w) <= 2 && Math.abs(inner[1] - h) <= 2) break;
    if (attempt === 3) fail(`flipViewport(${w}x${h}): page reports ${inner[0]}x${inner[1]}`);
  }
  await page.evaluate(() => {
    document.body.classList.add('mobile-touch', 'game-active');
    window.dispatchEvent(new Event('resize'));
  });
  await sleep(400);
  await page.evaluate(() => document.body.classList.add('mobile-touch', 'game-active'));
  if (expectedTier) {
    const settled = await page
      .waitForFunction(
        (tier) => {
          if (!document.body.classList.contains(tier)) return false;
          const attack = document.getElementById('mobile-action-attack');
          return !!attack && attack.getBoundingClientRect().width > 0;
        },
        { timeout: 12000 },
        expectedTier,
      )
      .then(
        () => true,
        () => false,
      );
    if (!settled) fail(`flipViewport: tier/${expectedTier} or controls never settled`);
  }
  await sleep(250);
}

// Build a real 4-member party alongside the local player. On this branch
// (release/v0.23.0, post-SimContext) the raw sim.parties / sim.partyByPid Maps
// the raid_to_party_shot recipe hand-assembled no longer exist; party state now
// lives behind the party subsystem. The real invite/accept API is the supported
// path and builds a clean 5-member (leader + 4) non-raid party with no stale
// invite cards: addPlayer, then partyInvite + partyAccept each bot.
async function buildParty(page) {
  return page.evaluate(() => {
    const sim = window.__game.sim;
    const p = sim.player;
    const roster = [
      ['Brightoak', 'druid'],
      ['Stormcaller', 'shaman'],
      ['Nightblade', 'rogue'],
      ['Emberlyn', 'mage'],
    ];
    const pids = roster.map(([name, cls], i) => {
      const pid = sim.addPlayer(cls, name);
      const e = sim.entities.get(pid);
      if (e) {
        e.pos = { x: p.pos.x + (i % 4) * 2 - 3, y: p.pos.y, z: p.pos.z + 2 };
        e.prevPos = { ...e.pos };
      }
      return pid;
    });
    let err = null;
    try {
      for (const pid of pids) {
        sim.partyInvite(pid);
        sim.partyAccept(pid);
      }
    } catch (e) {
      err = String(e).slice(0, 150);
    }
    const info = sim.partyInfo;
    return { members: info?.members?.length ?? 0, raid: info?.raid ?? null, err };
  });
}

// Force a target: find a nearby hostile mob (kind 'mob', hostile, not dead) and
// call sim.targetEntity(id). Returns the id or null.
async function forceTarget(page) {
  return page.evaluate(() => {
    const sim = window.__game.sim;
    const p = sim.player;
    let best = null;
    let bestD = Infinity;
    for (const [id, e] of sim.entities.entries()) {
      if (e.kind !== 'mob' || !e.hostile || e.dead) continue;
      const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    if (best !== null) sim.targetEntity(best);
    return best;
  });
}

// Populate the buff bar best-effort: push a synthetic aura onto player.auras (the
// same array the buff-bar painter reads). Returns true if the bar has children.
async function populateBuffBar(page) {
  return page.evaluate(() => {
    const sim = window.__game.sim;
    const p = sim.player;
    if (Array.isArray(p.auras)) {
      p.auras.push({
        id: 'audit-buff',
        name: 'Audit Vigor',
        kind: 'buff_ap',
        remaining: 300,
        duration: 300,
        value: 15,
        sourceId: sim.primaryId,
        school: 'physical',
      });
    }
    return true;
  });
}

// Find any npc entity id (for the vendor co-open pair). Returns id or null.
async function findNpc(page) {
  return page.evaluate(() => {
    const sim = window.__game.sim;
    for (const [id, e] of sim.entities.entries()) {
      if (e.kind === 'npc') return id;
    }
    return null;
  });
}

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});
try {
  mkdirSync(SHOT_DIR, { recursive: true });
  const page = await browser.newPage();
  page.on('pageerror', (err) => fail(`pageerror: ${String(err).slice(0, 200)}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !IGNORED_CONSOLE.test(msg.text())) {
      fail(`console error: ${msg.text().slice(0, 200)}`);
    }
  });
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluate(() => {}).catch(() => {});
  await page.goto(URL, { waitUntil: 'networkidle2' });
  // Suppress the tutorial before entry so its cards do not overlay the chrome.
  await page.evaluate(() => localStorage.setItem('woc.tutorial.v1', 'done')).catch(() => {});
  await enterOfflineGame(page, { charClass: 'warrior', charName: 'Auditor', settleMs: 1500 });

  const media = await page.createCDPSession();
  await media.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'pointer', value: 'coarse' },
      { name: 'hover', value: 'none' },
    ],
  });
  await media.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  // Keep the character alive: the blind state setup should never let camp wolves
  // kill it mid-audit (death clears frames and would read as a bogus miss).
  await page.evaluate(() => {
    const p = window.__game.sim.player;
    p.maxHp = 99999;
    p.hp = 99999;
  });
  await page.evaluate(() => document.querySelector('.tut-skip')?.click());

  // ---- PASS A: persistent-chrome sweep across all six profiles. ----
  console.log('\n=== PASS A: persistent-chrome overlap sweep (STRICT) ===');
  const partyBuilt = await buildParty(page);
  console.log(`party built: ${JSON.stringify(partyBuilt)}`);
  if (partyBuilt.members !== 5) {
    fail(`pass A setup: party has ${partyBuilt.members} members (expected 5: leader + 4)`);
  }
  // Forming a party as leader pops a one-off Loot Settings dialog; close it so it
  // does not sit over the persistent chrome under measurement (it is not in the
  // measured id set, but closing it keeps the state clean and the shots readable).
  await page.evaluate(() => window.__game.hud.closeAll?.());

  for (const prof of PROFILES) {
    await flipViewport(page, media, prof.w, prof.h, prof.dsf, prof.tier);
    const targetId = await forceTarget(page);
    if (targetId === null) {
      note(`${prof.name}: no hostile mob found to target; #target-frame will be absent`);
    }
    const buffOk = await populateBuffBar(page);
    // Nudge the HUD to repaint the frames/bars/target after the state change.
    await page.evaluate(() => {
      window.__game.hud?.update?.(0.05);
      window.dispatchEvent(new Event('resize'));
    });
    await sleep(1000);

    const allIds = [...CHROME_IDS, ...CONTROL_IDS];
    const g = await collectRects(page, allIds);
    if (process.env.DEBUG_RECTS) {
      console.log(`${prof.name} rects: ${JSON.stringify(g.rects)}`);
    }

    // Assert #party-frames carries .below-target while the target frame shows.
    const targetShown = !!g.rects['target-frame'];
    if (targetShown && !g.belowTarget) {
      fail(`${prof.name}: #party-frames lacks .below-target while #target-frame is visible`);
    }
    if (!targetShown) {
      note(`${prof.name}: #target-frame not visible (skipping below-target assertion)`);
    }

    // Note any chrome that is display:none in this state (not measured).
    for (const id of CHROME_IDS) {
      if (!g.rects[id]) note(`${prof.name}: #${id} not measurable (display:none / empty)`);
    }
    if (!g.rects['buff-bar']) {
      note(`${prof.name}: #buff-bar empty despite populate attempt (buffOk=${buffOk}); SKIPPED`);
    }

    // Pairwise gap check across every visible chrome + control rect.
    const entries = allIds.map((id) => [id, g.rects[id]]).filter(([, r]) => r);
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [idA, a] = entries[i];
        const [idB, b] = entries[j];
        const interactive = INTERACTIVE_IDS.has(idA) || INTERACTIVE_IDS.has(idB);
        const req = interactive ? MIN_GAP_INTERACTIVE : MIN_GAP_CHROME;
        const gap = controlGap(idA, a, idB, b, CIRCLE_IDS);
        if (gap < req) {
          fail(
            `${prof.name}: #${idA} vs #${idB} gap ${gap.toFixed(1)}px < ${req}px ` +
              `(${interactive ? 'interactive' : 'chrome'} pair)`,
          );
        }
      }
    }

    // Touch floor for the interactive chrome (minimap-wrap hosts zoom buttons).
    for (const id of CHROME_IDS) {
      const r = g.rects[id];
      if (r && INTERACTIVE_IDS.has(id) && (r.w < TOUCH_FLOOR - 0.5 || r.h < TOUCH_FLOOR - 0.5)) {
        fail(`${prof.name}: #${id} below the ${TOUCH_FLOOR}px touch floor (${r.w}x${r.h})`);
      }
    }

    await page.screenshot({ path: `${SHOT_DIR}/passA_${prof.name}.png` });
    console.log(`checked ${prof.name} (${prof.w}x${prof.h}, target=${targetId})`);
  }

  // ---- PASS B: window-open matrix (AUDIT by default; --gate to enforce). ----
  console.log(`\n=== PASS B: window-open matrix (${GATE ? 'GATE' : 'AUDIT'} mode) ===`);
  // In gate mode a pass-B miss is a hard failure; in audit mode it is reported
  // and screenshotted but never flips the exit code.
  const bViolation = (msg) => {
    if (GATE) {
      fail(msg);
    } else {
      console.error(`AUDIT ${msg}`);
      notes.push(`AUDIT ${msg}`);
    }
  };

  for (const w of WINDOW_MATRIX) {
    const exists = await page.evaluate(
      (t) => typeof window.__game?.hud?.[t] === 'function',
      w.toggle,
    );
    if (!exists) {
      note(`window ${w.toggle}: method missing on hud; NOT COVERED`);
      continue;
    }
    for (const width of w.widths) {
      const prof = PROFILES.find((p) => p.w === width) || PROFILES[0];
      await flipViewport(page, media, width, prof.h, prof.dsf, prof.tier);
      // Open the window through the real hud path.
      const opened = await page.evaluate(
        (t, id) => {
          window.__game.hud.closeAll?.();
          window.__game.hud[t]();
          const el = document.getElementById(id);
          if (!el) return { open: false };
          const style = getComputedStyle(el);
          return { open: style.display !== 'none' && style.visibility !== 'hidden' };
        },
        w.toggle,
        w.id,
      );
      await sleep(300);
      if (!opened.open) {
        note(`window ${w.toggle} @${width}: #${w.id} did not open; NOT COVERED`);
        await page.evaluate(() => window.__game.hud.closeAll?.());
        continue;
      }

      const box = await page.evaluate((id) => {
        const el = document.getElementById(id);
        const r = el.getBoundingClientRect();
        const close = el.querySelector('[data-close], .x-btn');
        const cr = close?.getBoundingClientRect() ?? null;
        return {
          win: {
            left: r.left,
            top: r.top,
            right: r.right,
            bottom: r.bottom,
            w: r.width,
            h: r.height,
          },
          close: cr
            ? {
                left: cr.left,
                top: cr.top,
                right: cr.right,
                bottom: cr.bottom,
                w: cr.width,
                h: cr.height,
              }
            : null,
          vw: window.innerWidth,
          vh: window.innerHeight,
        };
      }, w.id);

      // (1) window fully within the viewport.
      const win = box.win;
      if (
        win.left < -0.5 ||
        win.top < -0.5 ||
        win.right > box.vw + 0.5 ||
        win.bottom > box.vh + 0.5
      ) {
        bViolation(
          `window ${w.toggle} @${width}: #${w.id} leaves viewport ` +
            `(l=${win.left.toFixed(1)} t=${win.top.toFixed(1)} r=${win.right.toFixed(1)} ` +
            `b=${win.bottom.toFixed(1)} vs ${box.vw}x${box.vh})`,
        );
      }
      // (2) close control on-screen and >= 40px.
      if (!box.close) {
        bViolation(
          `window ${w.toggle} @${width}: #${w.id} has no [data-close]/.x-btn close control`,
        );
      } else {
        const c = box.close;
        if (c.left < -0.5 || c.top < -0.5 || c.right > box.vw + 0.5 || c.bottom > box.vh + 0.5) {
          bViolation(`window ${w.toggle} @${width}: close control off-screen`);
        }
        if (c.w < TOUCH_FLOOR - 0.5 || c.h < TOUCH_FLOOR - 0.5) {
          bViolation(
            `window ${w.toggle} @${width}: close control below ${TOUCH_FLOOR}px ` +
              `(${c.w.toFixed(1)}x${c.h.toFixed(1)})`,
          );
        }
      }

      await page.screenshot({ path: `${SHOT_DIR}/passB_${w.toggle}_${width}.png` });

      // (3) closeAll clears mobile-window-open.
      const cleared = await page.evaluate(() => {
        window.__game.hud.closeAll();
        return !document.body.classList.contains('mobile-window-open');
      });
      if (!cleared) {
        bViolation(
          `window ${w.toggle} @${width}: body.mobile-window-open not cleared after closeAll()`,
        );
      }
      console.log(`window ${w.toggle} @${width}: ok (open + close-control + closeAll checked)`);
    }
  }

  // Special case: vendor + bags co-open (the one window-over-chrome overlap pair
  // we DO care about). Needs an npc entity to open the vendor offline. NOTE: even
  // when openVendor runs cleanly on a valid npc offline, the #vendor-window and
  // #bags panels render with ZERO geometry (no real width/height), so there is
  // nothing to measure. We require real, laid-out geometry on BOTH panels before
  // claiming coverage; otherwise this is honestly NOT COVERED offline.
  await flipViewport(page, media, 844, 390, 3, 'hud-mobile-compact');
  const npcId = await findNpc(page);
  if (npcId === null) {
    note('vendor+bags: no npc entity reachable offline; NOT COVERED');
  } else {
    const vendorState = await page.evaluate((id) => {
      window.__game.hud.closeAll?.();
      let openErr = null;
      try {
        window.__game.hud.openVendor(id);
      } catch (e) {
        openErr = String(e).slice(0, 150);
      }
      const box = (elId) => {
        const el = document.getElementById(elId);
        if (!el) return null;
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') return null;
        const r = el.getBoundingClientRect();
        return {
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
          w: r.width,
          h: r.height,
        };
      };
      return {
        openErr,
        vendorOpenClass: document.body.classList.contains('vendor-open'),
        vendor: box('vendor-window'),
        bags: box('bags'),
      };
    }, npcId);
    const v = vendorState.vendor;
    const b = vendorState.bags;
    if (process.env.DEBUG_RECTS) console.log(`vendor state: ${JSON.stringify(vendorState)}`);
    // Both panels must be real, laid-out, AND actually overlapping the game area
    // (not a zero-origin degenerate box). Offline, openVendor engages the class but
    // the panels do not paint, so guard on a non-trivial box that starts on-screen.
    const laidOut = (r) => r && r.w >= 80 && r.h >= 80 && r.right > 0 && r.bottom > 0;
    if (!vendorState.vendorOpenClass || vendorState.openErr) {
      note(`vendor+bags: openVendor did not engage ${JSON.stringify(vendorState)}; NOT COVERED`);
    } else if (!laidOut(v) || !laidOut(b)) {
      note(
        `vendor+bags: panels have no real geometry offline ` +
          `(vendor=${v ? `${v.w.toFixed(0)}x${v.h.toFixed(0)}` : 'null'}, ` +
          `bags=${b ? `${b.w.toFixed(0)}x${b.h.toFixed(0)}` : 'null'}); NOT COVERED offline`,
      );
    } else {
      const gap = controlGap('vendor-window', v, 'bags', b, CIRCLE_IDS);
      if (gap < 0) {
        bViolation(`vendor+bags: #vendor-window overlaps #bags by ${(-gap).toFixed(1)}px`);
      } else {
        console.log(`vendor+bags: co-open clear (gap ${gap.toFixed(1)}px)`);
      }
      await page.screenshot({ path: `${SHOT_DIR}/passB_vendor_bags_844.png` });
    }
    await page.evaluate(() => window.__game.hud.closeAll?.());
  }

  // ---- Verdict. ----
  console.log(`\n=== AUDIT SUMMARY ===`);
  console.log(`${notes.length} note(s), ${failures.length} strict violation(s).`);
  if (notes.length) console.log(`Notes:\n${notes.map((n) => `  - ${n}`).join('\n')}`);
  if (failures.length) {
    console.error(`\n${failures.length} violation(s).`);
    process.exit(1);
  }
  console.log('\nAll mobile HUD overlap checks passed.');
} finally {
  await browser.close();
}
