import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The Node major every deploy and CI carrier must agree on, and the exact runtime
// base tag. A coordinated bump moves this ONE constant plus the four carriers read
// below; a bump that forgets any single carrier fails that carrier's extraction
// assertion here. This is deliberately a cross-carrier pin, unlike the
// deploy_watchdog literal (which freezes DEPLOY.md's gate line against its own text
// only, never against the Dockerfile), so a later bump that moves the Dockerfile and
// both CI files but forgets DEPLOY.md's `docker run ... node:<tag>` gate image still
// reds, and vice versa.
const TARGET_MAJOR = 26;
const TARGET_TAG = 'node:26-slim';

const dockerfile = readFileSync('Dockerfile', 'utf8');
const ciWorkflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const prAiWorkflow = readFileSync('.github/workflows/pr-ai.yml', 'utf8');
const desktopWorkflow = readFileSync('.github/workflows/desktop-publish.yml', 'utf8');
const deployDoc = readFileSync('DEPLOY.md', 'utf8');

/** Every major in a `FROM node:<major>...` stage line across a Dockerfile. */
function dockerfileFromMajors(text: string): number[] {
  return [...text.matchAll(/^FROM node:(\d+)[-.\w]*/gm)].map((m) => Number(m[1]));
}

/**
 * Every `node-version: <major>` value in a GitHub Actions workflow file. The optional
 * quote tolerates `node-version: '26'`; without it a future edit that both quotes AND
 * wrong-values one line would slip past the extraction while the literal pins passed on
 * the surviving unquoted lines.
 */
function nodeVersionValues(text: string): number[] {
  return [...text.matchAll(/node-version:\s*['"]?(\d+)/g)].map((m) => Number(m[1]));
}

/**
 * The Node major from DEPLOY.md's containerized tsc-gate `docker run ... -w /app node:<tag>`.
 * Anchored on the `-w /app node:` fragment (the same fragment the literal pin below uses),
 * so a future unrelated `docker run node:` example prepended above the gate cannot shift it.
 */
function deployGateMajor(text: string): number | null {
  const match = text.match(/-w \/app node:(\d+)[-.\w]*/);
  return match ? Number(match[1]) : null;
}

describe('deploy and CI Node version pin', () => {
  // Both Dockerfile stages (build and runtime) must sit on TARGET_MAJOR. The
  // extraction catches a bump that moves only one stage; the length check guards
  // against a stage being deleted, which would otherwise let `every` pass vacuously
  // on the surviving line. The literal count is the belt-and-suspenders pin: a
  // reformat that slips past the regex still has to keep two `FROM node:26-slim`.
  it('pins both Dockerfile FROM stages to the target Node major', () => {
    const majors = dockerfileFromMajors(dockerfile);
    expect(majors).toHaveLength(2);
    for (const major of majors) expect(major).toBe(TARGET_MAJOR);
    // split() length is occurrences + 1, so two `FROM node:26-slim` gives 3.
    expect(dockerfile.split(`FROM ${TARGET_TAG}`)).toHaveLength(3);
  });

  // Every actions/setup-node step in the main CI workflow must be on TARGET_MAJOR.
  // desktop-publish.yml is deliberately NOT read here: the Steam/Electron publish
  // path is intentionally held on Node 22, so folding it in would wrongly red this
  // pin. The non-empty guard stops a workflow that lost all its node-version lines
  // from passing vacuously through `every`.
  it('pins every ci.yml node-version to the target Node major', () => {
    const values = nodeVersionValues(ciWorkflow);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(value).toBe(TARGET_MAJOR);
    expect(ciWorkflow).toContain(`node-version: ${TARGET_MAJOR}`);
  });

  it('pins every pr-ai.yml node-version to the target Node major', () => {
    const values = nodeVersionValues(prAiWorkflow);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(value).toBe(TARGET_MAJOR);
    expect(prAiWorkflow).toContain(`node-version: ${TARGET_MAJOR}`);
  });

  // DEPLOY.md's containerized tsc-gate builds the type check inside
  // `docker run ... node:<tag>`. This is the carrier the deploy_watchdog literal
  // cannot catch drifting against the rest, so extract its major and equate it to
  // TARGET_MAJOR explicitly, plus an anchored literal so a matching reformat still
  // has to carry the exact base tag on the gate line.
  it('pins the DEPLOY.md containerized tsc-gate image to the target Node major', () => {
    const major = deployGateMajor(deployDoc);
    expect(major).not.toBeNull();
    expect(major).toBe(TARGET_MAJOR);
    expect(deployDoc).toContain(`-w /app ${TARGET_TAG}`);
  });

  // desktop-publish.yml is DELIBERATELY held on Node 22: the Steam/Electron publish
  // path stays on 22 by an intentional decision until it is separately revisited. This
  // positive pin locks that intentional divergence: it reds if desktop-publish.yml is
  // accidentally swept to the target major with the rest, forcing a conscious decision
  // (and an update here) rather than a silent bump. If the publish path is later moved
  // to the target too, fold it into nodeVersionValues above and delete this.
  it('keeps desktop-publish.yml on Node 22, not the target major', () => {
    const values = nodeVersionValues(desktopWorkflow);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(value).toBe(22);
    expect(desktopWorkflow).not.toContain(`node-version: ${TARGET_MAJOR}`);
  });
});
