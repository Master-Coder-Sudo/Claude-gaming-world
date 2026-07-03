// Rename state-hash proof (reverse-map re-digest) — the committed gate behind the
// OPERATOR RULING ADDENDUM (2026-07-02) in ip-refactor/02-WORKING-MEMORY.md:
// per-frame `state` digests fold sampled `Aura.name` values (ability DISPLAY
// names), so a locked NAME-MAP display rename legitimately moves the state hash
// of any frame where a renamed-name aura is active at the sample instant. Such
// deltas are sanctioned ONLY when this proof passes: the inspector
// (ip-refactor/golden_token_inspector.mjs) accepts them only under
// --allow-state-hashes, and slice QA re-runs BOTH this proof and the inspector.
//
// Method, per scenario whose golden frame `state` hashes differ from the base
// ref: re-record the scenario, capture the RAW per-frame {players, entities}
// samples, reverse-map every string leaf new->old via the LOCKED NAME-MAP, and
// re-digest. Every changed frame MUST reproduce the base golden's state hash
// exactly — proving the delta is precisely the locked token swaps and nothing
// else (any numeric / structural / unmapped-string drift fails to reproduce).
//
// Gating + base ref:
//   RENAME_PROOF=1       — required; the suite is skipped otherwise (it re-records
//                          scenarios and shells out to git, so it is not part of
//                          the default parity gate).
//   RENAME_PROOF_BASE    — git ref of the PRE-SLICE goldens to prove against
//                          (default: HEAD). Before the slice commit, HEAD still
//                          holds the pre-slice goldens, so the default works; AFTER
//                          the commit HEAD's goldens equal the worktree's and the
//                          run is a vacuous no-delta pass. QA therefore re-runs it
//                          with the slice's merge-base (pre-slice) sha:
//   RENAME_PROOF=1 RENAME_PROOF_BASE=<pre-slice sha> \
//     npx vitest run tests/parity/rename_state_proof.test.ts
//
// Deterministic by construction: seeded scenario re-records + `git show` of a
// pinned ref; no Date.now / Math.random anywhere.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Recorder, record } from './record';
import { SCENARIOS } from './scenarios';
import { digest, sampleEntity, samplePlayerMeta } from './trace';

const ENABLED = !!process.env.RENAME_PROOF;
const BASE_REF = process.env.RENAME_PROOF_BASE || 'HEAD';
const ROOT = join(__dirname, '..', '..');
const GOLDEN_DIR = join(__dirname, 'golden');

// ---- locked pairs, parsed exactly like ip-refactor/golden_token_inspector.mjs ----
function loadReversePairs(): Array<[string, string]> {
  const displayPairs: Array<[string, string]> = [];
  const mapText = readFileSync(join(ROOT, 'ip-refactor', 'NAME-MAP.md'), 'utf8');
  for (const line of mapText.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const c = line.split('|').map((x) => x.trim());
    if (c.length !== 7) continue;
    const [, , oldName, newName, , flag] = c;
    if (!['rename', 'coined-id', 'pairing'].includes(flag)) continue;
    if (!oldName || oldName === 'old' || /^[-: ]+$/.test(oldName)) continue;
    if (oldName.includes('(') || oldName.includes('"')) continue;
    if (oldName === newName) continue;
    if (oldName.startsWith('`')) continue; // backticked = code id row (family ids)
    displayPairs.push([oldName, newName]);
  }
  // reverse map: new -> old, longest-new-first, token-boundary replace
  return displayPairs
    .map(([o, n]) => [n, o] as [string, string])
    .sort((a, b) => b[0].length - a[0].length);
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function makeReverseMapper(): (v: unknown) => unknown {
  const reversePairs = loadReversePairs();
  const mapString = (s: string): string => {
    let out = s;
    for (const [n, o] of reversePairs) out = out.replace(new RegExp(`\\b${esc(n)}\\b`, 'g'), o);
    return out;
  };
  const deep = (v: unknown): unknown => {
    if (typeof v === 'string') return mapString(v);
    if (Array.isArray(v)) return v.map(deep);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = deep(val);
      return out;
    }
    return v;
  };
  return deep;
}

// ---- wrap the (compile-time-private) pushFrame to stash raw samples ----
// Replicates pushFrame's sampling exactly (value copies; no mutation), so
// digest({players, entities}) over a stashed raw frame equals that frame's
// recorded `state` hash by construction.
type RawFrame = { players: unknown[]; entities: unknown[] };
const rawByRecorder = new WeakMap<Recorder, RawFrame[]>();
if (ENABLED) {
  const proto = Recorder.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  const origPush = proto.pushFrame;
  proto.pushFrame = function (this: Recorder, ...args: unknown[]) {
    const sim = (this as unknown as { sim: unknown }).sim as {
      players: Map<number, unknown>;
      entities: Map<number, unknown>;
    };
    const trackIds = (this as unknown as { trackIds: Set<number> }).trackIds;
    const playerIds = [...sim.players.keys()].sort((a, b) => a - b);
    const entityIds = [...new Set([...playerIds, ...trackIds])].sort((a, b) => a - b);
    const players = playerIds.map((pid) => samplePlayerMeta(sim.players.get(pid) as never));
    const entities = entityIds
      .map((id) => sim.entities.get(id))
      .filter((e): e is object => e !== undefined)
      .map((e) => sampleEntity(e as never));
    let store = rawByRecorder.get(this);
    if (!store) {
      store = [];
      rawByRecorder.set(this, store);
    }
    store.push({ players, entities });
    return origPush.apply(this, args);
  };
}

interface GoldenTrace {
  frames: Array<{ state: string }>;
}

function baseGolden(name: string): GoldenTrace {
  const text = execFileSync(
    'git',
    ['-C', ROOT, 'show', `${BASE_REF}:tests/parity/golden/${name}.json`],
    { encoding: 'utf8', maxBuffer: 1 << 28 },
  );
  return JSON.parse(text) as GoldenTrace;
}

// Discover the scenarios whose on-disk golden frame `state` hashes differ from
// the base ref. Only those are re-recorded (re-recording all ~50 is needless:
// unchanged-state scenarios are already covered byte-for-byte by the parity gate
// plus the inspector).
function changedScenarioNames(): string[] {
  const changed: string[] = [];
  for (const file of readdirSync(GOLDEN_DIR)) {
    if (!file.endsWith('.json')) continue;
    const name = file.slice(0, -'.json'.length);
    let base: GoldenTrace;
    try {
      base = baseGolden(name);
    } catch {
      continue; // not in the base ref: a NEW golden — the inspector rejects it.
    }
    const work = JSON.parse(readFileSync(join(GOLDEN_DIR, file), 'utf8')) as GoldenTrace;
    if (base.frames.length !== work.frames.length) {
      changed.push(name); // let the per-scenario test fail loudly on the length
      continue;
    }
    if (base.frames.some((f, i) => f.state !== work.frames[i].state)) changed.push(name);
  }
  return changed.sort();
}

describe.skipIf(!ENABLED)(
  `rename state-hash proof: state-digest deltas vs ${BASE_REF} are exactly locked token swaps`,
  () => {
    const names = ENABLED ? changedScenarioNames() : [];
    if (names.length === 0) {
      it(`no state-hash deltas against ${BASE_REF} — nothing to prove`, () => {
        expect(names).toEqual([]);
      });
      return;
    }
    const reverseMapDeep = makeReverseMapper();
    for (const name of names) {
      it(name, () => {
        const scenario = SCENARIOS.find((s) => s.name === name);
        expect(scenario, `golden ${name}.json has no matching scenario`).toBeDefined();
        const { trace, rec } = record(scenario!);
        const raw = rawByRecorder.get(rec)!;
        expect(raw.length).toBe(trace.frames.length);
        const base = baseGolden(name);
        expect(base.frames.length).toBe(trace.frames.length);
        const unexplained: string[] = [];
        let mapped = 0;
        for (let i = 0; i < trace.frames.length; i++) {
          const newHash = trace.frames[i].state;
          const oldHash = base.frames[i].state;
          if (newHash === oldHash) continue;
          const reversed = digest(reverseMapDeep(raw[i]));
          if (reversed === oldHash) {
            mapped++;
          } else {
            unexplained.push(
              `frame ${i}: new=${newHash} base=${oldHash} reverseMapped=${reversed}`,
            );
          }
        }
        // eslint-disable-next-line no-console
        console.log(
          `${name}: changed-state frames explained by locked swaps: ${mapped}; unexplained: ${unexplained.length}`,
        );
        expect(unexplained).toEqual([]);
      });
    }
  },
);
