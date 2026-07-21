// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { TIER_SKILL_STEP } from '../src/sim/professions/wheel';
import { buildProfessionTutorialModel } from '../src/ui/profession_tutorial_view';
import { renderProfessionTutorial } from '../src/ui/profession_tutorial_window';

describe('renderProfessionTutorial', () => {
  it('paints a labelled modal with the ordered explainer paragraphs and wires both dismiss controls', () => {
    document.body.innerHTML = '';
    const onClose = vi.fn();
    const el = renderProfessionTutorial(buildProfessionTutorialModel(), { onClose });

    expect(el.id).toBe('profession-tutorial');
    expect(el.className).toContain('window');
    // WCAG dialog chrome via markDialogRoot: role, modal, and one accessible
    // name (the visible title).
    expect(el.getAttribute('role')).toBe('dialog');
    expect(el.getAttribute('aria-modal')).toBe('true');
    expect(el.getAttribute('aria-labelledby')).toBe('profession-tutorial-title');
    expect(el.querySelector('#profession-tutorial-title')?.textContent).toBeTruthy();

    // Three explainer paragraphs; the tier-cap paragraph interpolates the
    // first-tier threshold from the sim constant.
    const paras = el.querySelectorAll('.cd-body .cd-para');
    expect(paras).toHaveLength(3);
    expect(paras[0].textContent).toContain(String(TIER_SKILL_STEP));

    // Both the header x and the footer button dismiss.
    el.querySelector<HTMLButtonElement>('.cd-actions .cd-ok')?.click();
    expect(onClose).toHaveBeenCalledTimes(1);
    el.querySelector<HTMLButtonElement>('.panel-title .x-btn')?.click();
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('replaces a prior instance instead of stacking the one-shot', () => {
    document.body.innerHTML = '';
    renderProfessionTutorial(buildProfessionTutorialModel(), { onClose: vi.fn() });
    renderProfessionTutorial(buildProfessionTutorialModel(), { onClose: vi.fn() });
    expect(document.querySelectorAll('#profession-tutorial')).toHaveLength(1);
  });
});
