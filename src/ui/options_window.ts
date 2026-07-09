// Options window painter: the Warden's Codex desktop chrome (P2).
//
// Owns the #options-menu DOM, adopting the shared window-frame builder
// (window_frame.ts) at XL size and painting a recessed category rail + detail
// two-pane off the pure view-models in options_view.ts (which consume the
// options_ia tree). The window is a full-attention modal: non-draggable and
// non-resizable (excluded in window_drag_handle.ts + window_resize.ts), always
// opening on the Overview landing.
//
// This is the thin DOM consumer per the vendor_window template. Every setting
// row's dispatch is byte-identical to the pre-redesign painter: the pure
// coercions (sliderDispatchValue / toggleNextValue / boolToggleNextValue) and
// the exact onSettingChange / settings.set calls are preserved; only the DOM
// grammar changed (the text ON/OFF button became the .opt-switch role=switch,
// choices became the .opt-seg radiogroup). The bespoke flows are ported intact:
// the language busy/failed picker, the theme preset + custom-colour grid, the
// keybind rebind table, the Controller per-button remap, and the delegated
// performance-overlay panel (drag-placement gated to the System category).
//
// No raw hex / magic values: every colour lives in the extracted stylesheet;
// the two numeric thresholds here are named constants. The graphics rows read
// the STATIC graphics preset as a plain setting value only.

import { syncAppViewport } from '../game/app_viewport';
import { audio } from '../game/audio';
import { GAMEPAD_NONE, gamepadButtonLabel } from '../game/gamepad_map';
import {
  BIND_ACTIONS,
  BIND_CATEGORIES,
  isReservedCode,
  type Keybinds,
  keyLabel,
} from '../game/keybinds';
import { isNativeAppShell, useTouchInterface } from '../game/mobile_controls';
import { music } from '../game/music';
import {
  BOOL_SETTINGS,
  type BoolSettingKey,
  type GameSettings,
  type NumericSettingKey,
  SETTING_RANGES,
} from '../game/settings';
import type { IWorld } from '../world_api';
import { appVersionInfo } from './app_version';
import type { ChatClock } from './chat_timestamp';
import { esc } from './esc';
import type { BugReportHooks, OptionsHooks } from './hud';
import {
  formatNumber,
  getLanguage,
  isSupportedLanguage,
  type SupportedLanguage,
  supportedLanguages,
  t,
} from './i18n';
import type { TranslationKey } from './i18n.catalog';
import {
  buildSearchIndex,
  CATEGORIES,
  type CategoryId,
  categorySettingKeys,
  OVERVIEW_PINS,
  OVERVIEW_QUICK_ACTIONS,
  type QuickActionId,
  settingRow,
} from './options_ia';
import {
  type BoolToggleControl,
  boolToggleNextValue,
  buildBugReportInfo,
  buildControlFromRow,
  type ChoiceControl,
  categoryChangedCount,
  categoryResetKeys,
  type OptionsControl,
  type OptionsSettingsSource,
  renderCategory,
  renderRailModel,
  rowMatchesQuery,
  type SliderControl,
  type SliderFmt,
  sliderDispatchValue,
  type ToggleControl,
  toggleIsOn,
  toggleNextValue,
  totalChangedCount,
} from './options_view';
import { PerfOverlaySettingsPanel, type PerfSettingsHost } from './perf_overlay_settings';
import {
  PRESET_ORDER,
  type PresetId,
  resolveTheme,
  THEME_KNOB_LABEL_KEY,
  THEME_KNOB_ORDER,
} from './theme';
import { svgIcon, type UiIconName } from './ui_icons';
import { renderWindowFrame, type WindowFrameParts } from './window_frame';
import type { WindowFrameDescriptor } from './window_frame_view';

// Maximum characters for the bug-report description (a named threshold).
const BUG_DESC_MAX_LEN = 2000;
// Full-scale percent for the slider gold-fill gradient (--range-fill is 0..100%).
const RANGE_FILL_FULL_PCT = 100;

// The XL frame descriptor. #options-menu is not a shared tenant, but the frame
// still mounts on an inner container so the shared window-frame CSS (:has(>
// .window-frame), .window > .window-frame) binds exactly as it does for vendor.
const OPTIONS_FRAME: WindowFrameDescriptor = {
  id: 'options-menu',
  titleKey: 'hud.options.gameMenu',
  closeLabelKey: 'hud.options.returnToGame',
  footer: true,
};

// Graphics keys that only apply after a reload (drive the Overview reload alert),
// and the four advanced sub-pickers revealed only at the Advanced preset (5).
const RELOAD_KEYS = new Set([
  'graphicsPreset',
  'terrainDetail',
  'foliageDensity',
  'effectsQuality',
  'shadowQuality',
]);
const ADVANCED_GFX_KEYS = new Set([
  'terrainDetail',
  'foliageDensity',
  'effectsQuality',
  'shadowQuality',
]);

// Rail category icon: best-fit mapping onto the existing UiIconName glyph set
// (dedicated rail glyphs are a follow-up). The label is always the primary
// affordance; the icon carries the rail when it collapses under 900px.
const RAIL_ICON: Record<string, UiIconName> = {
  home: 'menu',
  display: 'map',
  layout: 'nameplates',
  accessibility: 'interact',
  mouse: 'target',
  keyboard: 'character',
  gamepad: 'swap',
  touch: 'vibrate',
  audio: 'music',
  gauge: 'meters',
};
const railIcon = (slug: string): UiIconName => RAIL_ICON[slug] ?? 'menu';

// Endonyms for the in-game language picker; never localized (they render
// identically in every locale, matching the homepage footer picker).
const LANGUAGE_ENDONYMS: Record<SupportedLanguage, string> = {
  en: 'English (US)',
  es: 'Español (LatAm)',
  es_ES: 'Español (España)',
  fr_FR: 'Français (France)',
  fr_CA: 'Français (Canada)',
  en_CA: 'English (Canada)',
  it_IT: 'Italiano',
  de_DE: 'Deutsch',
  zh_CN: '简体中文',
  zh_TW: '繁體中文',
  ko_KR: '한국어',
  ja_JP: '日本語',
  pt_BR: 'Português (Brasil)',
  ru_RU: 'Русский',
  cs_CZ: 'Čeština',
  nl_NL: 'Nederlands',
  pl_PL: 'Polski',
  id_ID: 'Bahasa Indonesia',
  tr_TR: 'Türkçe',
  sv_SE: 'Svenska',
  vi_VN: 'Tiếng Việt',
  da_DK: 'Dansk',
};

// Localized labels for the keybind category headers + action rows.
const BIND_CATEGORY_LABEL_KEYS: Partial<Record<string, TranslationKey>> = {
  Movement: 'hud.keybinds.categories.movement',
  Targeting: 'hud.keybinds.categories.targeting',
  Interface: 'hud.keybinds.categories.interface',
  'Action Bar': 'hud.keybinds.categories.actionBar',
};
const BIND_ACTION_LABEL_KEYS: Partial<Record<string, TranslationKey>> = {
  forward: 'hud.keybinds.actions.forward',
  back: 'hud.keybinds.actions.back',
  turnLeft: 'hud.keybinds.actions.turnLeft',
  turnRight: 'hud.keybinds.actions.turnRight',
  strafeLeft: 'hud.keybinds.actions.strafeLeft',
  strafeRight: 'hud.keybinds.actions.strafeRight',
  jump: 'hud.keybinds.actions.jump',
  autorun: 'hud.keybinds.actions.autorun',
  target: 'hud.keybinds.actions.target',
  attackMove: 'hud.keybinds.actions.attackMove',
  interact: 'hud.keybinds.actions.interact',
  char: 'hud.keybinds.actions.char',
  spellbook: 'hud.keybinds.actions.spellbook',
  questlog: 'hud.keybinds.actions.questlog',
  map: 'hud.keybinds.actions.map',
  bags: 'hud.keybinds.actions.bags',
  nameplates: 'hud.keybinds.actions.nameplates',
  meters: 'hud.keybinds.actions.meters',
  social: 'hud.keybinds.actions.social',
  arena: 'hud.keybinds.actions.arena',
  chat: 'hud.keybinds.actions.chat',
  emoteWheel: 'hudChrome.keybinds.emoteWheel',
  targetFriendly: 'hudChrome.keybinds.targetFriendly',
  targetFriendlyNext: 'hudChrome.keybinds.targetFriendlyNext',
  discord: 'hudChrome.keybinds.discord',
  valecup: 'hudChrome.keybinds.valecup',
  talents: 'game.talents.title',
  leaderboard: 'game.leaderboard.title',
  calendar: 'hudChrome.calendar.keybindLabel',
  crafting: 'hudChrome.crafting.title',
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

/**
 * Hud-supplied glue. The window renders no item rows, so it composes no
 * PainterHostPresentation bag; it reads the world's bug-report slice and routes
 * the options / bug-report seams, the keybind store, the shared dropdown, focus
 * management, the confirm dialog, and the online flag through these closures.
 */
export interface OptionsWindowDeps {
  root(): HTMLElement;
  world(): IWorld;
  options(): OptionsHooks | null;
  bugReport(): BugReportHooks | null;
  keybinds(): Keybinds;
  slotActionName(slot: number): string | null;
  refreshKeybindLabels(): void;
  buildDropdown(
    options: { value: string; label: string }[],
    current: string,
    onChange?: (value: string) => void,
    placeholder?: string,
    a11y?: { ariaLabel?: string; labelledBy?: string },
  ): HTMLElement;
  setDropdownValue(root: HTMLElement, value: string): void;
  focusFirstInteractive(root: HTMLElement, preferredSelector?: string): void;
  closeOthers(): void;
  hideTooltip(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  log(message: string): void;
  resetChatWindow(): void;
  resetUnitFrames(): void;
  getChatTimestamps(): boolean;
  setChatTimestamps(on: boolean): void;
  getChatClock(): ChatClock;
  setChatClock(clock: ChatClock): void;
  /** True in authoritative online play (gates the online-only quick actions +
   *  the status readout). Optional: falls back to the bug-report seam presence. */
  isOnline?(): boolean;
  /** The shared confirm dialog (reset-all is confirm-gated). Optional: without
   *  it the reset runs immediately (wired by hud.ts). */
  confirmDialog?(
    title: string,
    body: string,
    okText: string,
    cancelText: string,
    onOk: () => void,
  ): void;
}

type SearchScope = 'all' | 'section';

export class OptionsWindow {
  private activeCategory: CategoryId = 'overview';
  private searchQuery = '';
  private searchScope: SearchScope = 'all';
  // A pushed sub-view (bug report) inside the detail pane; back returns to System.
  private subView: 'none' | 'bugreport' = 'none';
  private capturingKey: { action: string; index: number } | null = null;
  private keybindNote = '';
  private reloadPending = false;
  private perfSettings: PerfOverlaySettingsPanel | null = null;
  private returnFocus: HTMLElement | null = null;

  constructor(private readonly deps: OptionsWindowDeps) {}

  get isOpen(): boolean {
    return this.deps.root().style.display === 'flex';
  }

  private online(): boolean {
    return this.deps.isOnline ? this.deps.isOnline() : this.deps.bugReport() !== null;
  }

  private env(): { touch: boolean; nativeShell: boolean } {
    return { touch: useTouchInterface(), nativeShell: isNativeAppShell() };
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
      return;
    }
    // Re-sync --app-vh/--app-vw right before opening (see PR 1118): a stale
    // value from a fullscreen toggle/resize would hard-clip the framed panel.
    syncAppViewport();
    this.returnFocus = this.deps.captureFocus();
    this.deps.closeOthers();
    // Always open on Overview (never last-visited), scope reset to All.
    this.activeCategory = 'overview';
    this.subView = 'none';
    this.searchQuery = '';
    this.searchScope = 'all';
    this.capturingKey = null;
    this.keybindNote = '';
    this.deps.options()?.perfOverlay.setPlacement(false);
    this.render();
    this.deps.root().style.display = 'flex';
    music.pauseForMenu();
    audio.click();
  }

  close(): void {
    this.deps.root().style.display = 'none';
    this.capturingKey = null;
    this.deps.options()?.perfOverlay.setPlacement(false);
    this.deps.hideTooltip();
    music.resumeFromMenu();
    const target = this.returnFocus;
    this.returnFocus = null;
    this.deps.restoreFocus(target);
  }

  /** Push a dropped perf-overlay drag position into the open panel's sliders. */
  onPerfOverlayMoved(x: number, y: number): void {
    this.perfSettings?.syncPosition(x, y);
  }

  /** Re-render the Controller pane in place when a pad connects/disconnects. */
  refreshControllerLabels(): void {
    if (this.isOpen && this.activeCategory === 'controller' && this.subView === 'none')
      this.renderDetail();
  }

  // -------------------------------------------------------------------------
  // Frame + shell (stamped cold, then rail/detail repaint per interaction)
  // -------------------------------------------------------------------------

  private ensureFrame(): WindowFrameParts {
    const root = this.deps.root();
    const mounted = root.querySelector<HTMLElement>(':scope > .window-frame');
    const body = mounted?.querySelector<HTMLElement>('.window-body');
    if (mounted && body) {
      return {
        root: mounted,
        body,
        footer: mounted.querySelector<HTMLElement>('.window-footer'),
        tabButtons: [],
      };
    }
    const mount = document.createElement('div');
    const parts = renderWindowFrame(mount, OPTIONS_FRAME, { onClose: () => this.close() });
    root.replaceChildren(mount);
    return parts;
  }

  private render(): void {
    const { body, footer } = this.ensureFrame();
    body.replaceChildren();
    body.appendChild(this.buildSearchStrip());
    const grid = el('div', 'opt-body');
    const rail = el('div', 'opt-rail');
    rail.setAttribute('role', 'tablist');
    rail.setAttribute('aria-orientation', 'vertical');
    const detailScroll = el('div', 'opt-detail');
    const detailInner = el('div', 'opt-detail-inner');
    detailScroll.appendChild(detailInner);
    grid.append(rail, detailScroll);
    body.appendChild(grid);
    this.renderRail();
    this.renderDetail();
    if (footer) this.renderFooter(footer);
  }

  private railEl(): HTMLElement {
    return this.deps.root().querySelector<HTMLElement>('.opt-rail') as HTMLElement;
  }

  private detailEl(): HTMLElement {
    return this.deps.root().querySelector<HTMLElement>('.opt-detail-inner') as HTMLElement;
  }

  private buildSearchStrip(): HTMLElement {
    const strip = el('div', 'opt-search');
    const field = el('div', 'search-field');
    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'search-input';
    input.value = this.searchQuery;
    input.setAttribute('placeholder', t('hudChrome.options.searchPlaceholder'));
    input.setAttribute('aria-label', t('hudChrome.options.searchPlaceholder'));
    input.addEventListener('input', () => {
      this.searchQuery = input.value;
      // The input lives in the search strip, a sibling of the detail pane, so a
      // detail-only repaint preserves the caret + focus while typing.
      this.renderDetail();
    });
    field.appendChild(input);
    strip.appendChild(field);
    const scopes = el('div', 'opt-scopes');
    scopes.setAttribute('role', 'group');
    scopes.setAttribute('aria-label', t('hudChrome.options.searchPlaceholder'));
    const mkScope = (scope: SearchScope, labelKey: TranslationKey) => {
      const btn = el('button', 'opt-scope');
      btn.type = 'button';
      btn.textContent = t(labelKey);
      btn.setAttribute('aria-pressed', String(this.searchScope === scope));
      // "This section" is meaningless on the Overview landing.
      if (scope === 'section' && this.activeCategory === 'overview') btn.disabled = true;
      btn.addEventListener('click', () => {
        this.searchScope = scope;
        for (const b of scopes.querySelectorAll<HTMLElement>('.opt-scope'))
          b.setAttribute('aria-pressed', String(b === btn));
        this.renderDetail();
      });
      return btn;
    };
    scopes.append(
      mkScope('all', 'hudChrome.options.searchScopeAll'),
      mkScope('section', 'hudChrome.options.searchScopeThis'),
    );
    strip.appendChild(scopes);
    return strip;
  }

  // -------------------------------------------------------------------------
  // Rail
  // -------------------------------------------------------------------------

  private renderRail(): void {
    const rail = this.railEl();
    rail.replaceChildren();
    const hooks = this.deps.options();
    const changed = (id: CategoryId): number =>
      hooks ? categoryChangedCount(id, (key) => this.isChanged(hooks, key)) : 0;
    const model = renderRailModel(this.env(), changed);
    rail.appendChild(this.railTab(model.overview));
    for (const group of model.groups) {
      const head = el('div', 'opt-rail-group');
      head.textContent = t(group.labelKey);
      rail.appendChild(head);
      for (const tab of group.tabs) rail.appendChild(this.railTab(tab));
    }
  }

  private railTab(tab: {
    id: CategoryId;
    iconSlug: string;
    nameKey: TranslationKey;
    changedCount: number;
  }): HTMLElement {
    const name = t(tab.nameKey);
    const btn = el('button', 'opt-tab');
    btn.type = 'button';
    btn.setAttribute('role', 'tab');
    const active = this.activeCategory === tab.id && this.subView === 'none';
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
    btn.tabIndex = active ? 0 : -1;
    btn.title = name;
    const icon = el('span', 'opt-tab-icon');
    icon.innerHTML = svgIcon(railIcon(tab.iconSlug));
    const label = el('span', 'opt-tab-label');
    label.textContent = name;
    btn.append(icon, label);
    if (tab.changedCount > 0) {
      const count = el('span', 'opt-tab-count');
      count.textContent = formatNumber(tab.changedCount, { maximumFractionDigits: 0 });
      count.setAttribute(
        'aria-label',
        t('hudChrome.options.changed', {
          count: formatNumber(tab.changedCount, { maximumFractionDigits: 0 }),
        }),
      );
      btn.appendChild(count);
    }
    btn.addEventListener('click', () => this.setActiveCategory(tab.id));
    return btn;
  }

  private setActiveCategory(id: CategoryId): void {
    audio.click();
    this.activeCategory = id;
    this.subView = 'none';
    this.searchQuery = '';
    this.capturingKey = null;
    this.keybindNote = '';
    // Perf-overlay drag placement is gated to the System category being open.
    this.deps.options()?.perfOverlay.setPlacement(id === 'system');
    this.render();
  }

  // -------------------------------------------------------------------------
  // Detail dispatcher
  // -------------------------------------------------------------------------

  private renderDetail(): void {
    const detail = this.detailEl();
    detail.replaceChildren();
    if (this.subView === 'bugreport') {
      this.renderBugReport(detail);
      return;
    }
    const q = this.searchQuery.trim();
    if (q && this.searchScope === 'all') {
      this.renderSearchResults(detail, q);
      return;
    }
    if (this.activeCategory === 'overview') {
      this.renderOverview(detail);
      return;
    }
    if (this.activeCategory === 'system') {
      this.renderSystem(detail);
      return;
    }
    this.renderCategoryDetail(detail);
  }

  private settingsSource(hooks: OptionsHooks): OptionsSettingsSource {
    return {
      num: (key) => hooks.settings.get(key as NumericSettingKey),
      bool: (key) => hooks.settings.get(key as BoolSettingKey),
      range: (key) => SETTING_RANGES[key as NumericSettingKey],
    };
  }

  private isChanged(hooks: OptionsHooks, key: string): boolean {
    const bool = (BOOL_SETTINGS as Record<string, { def: boolean }>)[key];
    if (bool) return hooks.settings.get(key as BoolSettingKey) !== bool.def;
    const r = SETTING_RANGES[key as NumericSettingKey];
    return r ? hooks.settings.get(key as NumericSettingKey) !== r.def : false;
  }

  private categoryHead(parent: HTMLElement, id: CategoryId, nameKey: TranslationKey): void {
    const hooks = this.deps.options();
    const head = el('div', 'opt-cat-head');
    head.textContent = t(nameKey);
    // Scoped "Reset [category]" ghost action, shown once the category diverges.
    const changed = hooks ? categoryChangedCount(id, (key) => this.isChanged(hooks, key)) : 0;
    if (changed > 0 && categorySettingKeys(id).length > 0) {
      const reset = el('button', 'opt-section-reset');
      reset.type = 'button';
      reset.textContent = t('hud.options.resetToDefaults');
      reset.setAttribute('aria-label', t('hud.options.resetToDefaults'));
      reset.addEventListener('click', () => {
        audio.click();
        this.resetKeys(categoryResetKeys(id));
        this.render();
      });
      const bar = el('div', 'opt-section-head');
      bar.append(head, reset);
      parent.appendChild(bar);
    } else {
      parent.appendChild(head);
    }
  }

  private renderCategoryDetail(detail: HTMLElement): void {
    const hooks = this.deps.options();
    const model = renderCategory(this.activeCategory, this.env());
    this.categoryHead(detail, model.id, model.nameKey);
    const sub = el('div', 'opt-cat-sub');
    sub.textContent = t(model.subheadKey);
    detail.appendChild(sub);
    if (hooks) {
      const source = this.settingsSource(hooks);
      const q = this.searchScope === 'section' ? this.searchQuery.trim() : '';
      for (const section of model.sections) {
        const secEl = el('div', 'opt-section');
        const headEl = el('div', 'opt-section-head');
        const title = document.createElement('span');
        title.textContent = t(section.headKey);
        headEl.appendChild(title);
        secEl.appendChild(headEl);
        let shown = 0;
        for (const row of section.rows) {
          // Preset-then-detail: the advanced sub-pickers show only at Advanced (5).
          if (
            this.activeCategory === 'graphics' &&
            row.key &&
            ADVANCED_GFX_KEYS.has(row.key) &&
            Math.round(hooks.settings.get('graphicsPreset')) !== 5
          )
            continue;
          if (q && row.key) {
            const labelText = row.labelKey ? t(row.labelKey) : '';
            if (!rowMatchesQuery(labelText, row.key, q)) continue;
          }
          if (q && !row.key) continue; // hide notes / bespoke rows while filtering
          if (row.control === 'language') {
            this.languageRow(secEl);
            shown++;
            continue;
          }
          if (row.control === 'themePreset') {
            this.themeRow(secEl);
            shown++;
            continue;
          }
          const control = buildControlFromRow(source, row);
          if (!control) continue;
          if (control.control === 'choice' && row.key === 'graphicsPreset' && isNativeAppShell())
            control.options = control.options.filter((o) => o.value <= 3);
          this.applyControls(secEl, [control], hooks, () => this.render());
          shown++;
        }
        // Bespoke section resets (chat window, unit frame positions).
        if (this.appendSectionAction(secEl, section.id)) shown++;
        if (shown > 0) detail.appendChild(secEl);
      }
    }
    if (this.activeCategory === 'keybinds') this.renderKeybindTable(detail);
    if (this.activeCategory === 'controller') this.renderControllerButtons(detail);
    if (this.activeCategory === 'graphics') this.renderGraphicsReload(detail);
  }

  // -------------------------------------------------------------------------
  // Row primitives (the .opt-* grammar; dispatch is byte-identical)
  // -------------------------------------------------------------------------

  private sliderFormatter(fmt: SliderFmt): (v: number) => string {
    if (fmt === 'degrees')
      return (v) => `${formatNumber(Math.round(v), { maximumFractionDigits: 0 })}°`;
    if (fmt === 'oneDecimal') return (v) => formatNumber(v, { maximumFractionDigits: 1 });
    return (v) => formatNumber(v, { style: 'percent', maximumFractionDigits: 0 });
  }

  private applyControls(
    parent: HTMLElement,
    controls: OptionsControl[],
    hooks: OptionsHooks,
    rerender: () => void,
  ): void {
    for (const c of controls) {
      switch (c.control) {
        case 'slider':
          this.settingSlider(parent, c, hooks);
          break;
        case 'toggle':
          this.settingToggle(parent, c, hooks);
          break;
        case 'boolToggle':
          this.settingBoolToggle(parent, c, hooks);
          break;
        case 'choice':
          this.settingChoice(parent, c, hooks, c.rerender ? rerender : undefined);
          break;
        case 'note':
          this.noteRow(parent, c.textKey);
          break;
        case 'musicToggle':
          this.musicToggle(parent, c.labelKey);
          break;
      }
    }
  }

  private optRow(label: string): { row: HTMLElement; control: HTMLElement } {
    const row = el('div', 'opt-row');
    const name = el('span', 'opt-row-label');
    name.textContent = label;
    name.title = label;
    const control = el('div', 'opt-row-control');
    row.append(name, control);
    return { row, control };
  }

  private settingSlider(parent: HTMLElement, c: SliderControl, hooks: OptionsHooks): void {
    const key = c.key as NumericSettingKey;
    const label = t(c.labelKey);
    const { row, control } = this.optRow(label);
    row.dataset.key = c.key;
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'opt-slider';
    slider.min = String(c.min);
    slider.max = String(c.max);
    slider.step = String(c.step);
    slider.value = String(hooks.settings.get(key));
    slider.setAttribute('aria-label', label);
    const val = el('span', 'opt-slider-val');
    const fmt = this.sliderFormatter(c.fmt);
    const applyReadout = (text: string) => {
      val.textContent = text;
      slider.setAttribute('aria-valuetext', text);
    };
    const syncReadout = () => applyReadout(fmt(hooks.settings.get(key)));
    const readoutFromSlider = () => applyReadout(fmt(Number(slider.value)));
    syncReadout();
    const paintFill = () => {
      const min = Number(slider.min),
        max = Number(slider.max),
        v = Number(slider.value);
      const pct = max > min ? ((v - min) / (max - min)) * RANGE_FILL_FULL_PCT : 0;
      slider.style.setProperty(
        '--range-fill',
        `${Math.max(0, Math.min(RANGE_FILL_FULL_PCT, pct))}%`,
      );
    };
    paintFill();
    const commit = () => {
      hooks.onSettingChange(key, sliderDispatchValue(slider.value));
      syncReadout();
      paintFill();
    };
    if (c.commitOnChange) {
      slider.addEventListener('input', () => {
        readoutFromSlider();
        paintFill();
      });
      slider.addEventListener('change', commit);
    } else {
      slider.addEventListener('input', commit);
    }
    control.append(slider, val);
    parent.appendChild(row);
  }

  private settingToggle(parent: HTMLElement, c: ToggleControl, hooks: OptionsHooks): void {
    const key = c.key as NumericSettingKey;
    const label = t(c.labelKey);
    const { row, control } = this.optRow(label);
    row.dataset.key = c.key;
    const toggle = el('button', 'opt-switch');
    toggle.type = 'button';
    toggle.setAttribute('role', 'switch');
    const sync = () => {
      const on = toggleIsOn(hooks.settings.get(key));
      toggle.setAttribute('aria-checked', String(on));
      toggle.setAttribute('aria-label', label);
    };
    sync();
    toggle.addEventListener('click', () => {
      audio.click();
      hooks.onSettingChange(key, toggleNextValue(hooks.settings.get(key)));
      sync();
    });
    control.appendChild(toggle);
    parent.appendChild(row);
  }

  private settingBoolToggle(parent: HTMLElement, c: BoolToggleControl, hooks: OptionsHooks): void {
    const key = c.key as BoolSettingKey;
    const label = t(c.labelKey);
    const { row, control } = this.optRow(label);
    row.dataset.key = c.key;
    const toggle = el('button', 'opt-switch');
    toggle.type = 'button';
    toggle.setAttribute('role', 'switch');
    const sync = () => {
      const on = hooks.settings.get(key);
      toggle.setAttribute('aria-checked', String(on));
      toggle.setAttribute('aria-label', label);
    };
    sync();
    toggle.addEventListener('click', () => {
      audio.click();
      hooks.onSettingChange(
        key,
        hooks.settings.set(key, boolToggleNextValue(hooks.settings.get(key))),
      );
      sync();
    });
    control.appendChild(toggle);
    parent.appendChild(row);
  }

  private settingChoice(
    parent: HTMLElement,
    c: ChoiceControl,
    hooks: OptionsHooks,
    onChange?: () => void,
  ): void {
    const key = c.key as NumericSettingKey;
    const label = t(c.labelKey);
    const { row, control } = this.optRow(label);
    row.dataset.key = c.key;
    const seg = el('div', 'opt-seg');
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', label);
    const sync = () => {
      const current = Math.round(hooks.settings.get(key));
      for (const btn of seg.querySelectorAll<HTMLButtonElement>('button[data-value]')) {
        const selected = Number(btn.dataset.value) === current;
        btn.classList.toggle('is-selected', selected);
        btn.setAttribute('aria-checked', String(selected));
      }
    };
    for (const option of c.options) {
      const optionLabel = t(option.labelKey);
      const btn = el('button', 'opt-seg-btn');
      btn.type = 'button';
      btn.setAttribute('role', 'radio');
      btn.dataset.value = String(option.value);
      btn.textContent = optionLabel;
      btn.setAttribute('aria-label', optionLabel);
      btn.addEventListener('click', () => {
        audio.click();
        if (RELOAD_KEYS.has(c.key)) this.reloadPending = true;
        hooks.onSettingChange(key, option.value);
        sync();
        onChange?.();
      });
      seg.appendChild(btn);
    }
    control.appendChild(seg);
    parent.appendChild(row);
    sync();
  }

  private noteRow(parent: HTMLElement, textKey: TranslationKey): void {
    const note = el('div', 'opt-note');
    note.textContent = t(textKey);
    parent.appendChild(note);
  }

  private musicToggle(parent: HTMLElement, labelKey: TranslationKey): void {
    const label = t(labelKey);
    const { row, control } = this.optRow(label);
    const toggle = el('button', 'opt-switch');
    toggle.type = 'button';
    toggle.setAttribute('role', 'switch');
    const sync = () => {
      toggle.setAttribute('aria-checked', String(music.enabled));
      toggle.setAttribute('aria-label', label);
    };
    sync();
    toggle.addEventListener('click', () => {
      audio.click();
      music.setEnabled(!music.enabled);
      sync();
    });
    control.appendChild(toggle);
    parent.appendChild(row);
  }

  /** A bespoke "Reset [scope]" section action row (chat window, frame positions).
   *  Returns true when it appended a row (so the section is not treated empty). */
  private appendSectionAction(parent: HTMLElement, sectionId: string): boolean {
    if (this.searchQuery.trim()) return false; // hide bespoke actions while filtering
    if (this.activeCategory === 'interface' && sectionId === 'chat') {
      this.resetActionRow(parent, 'hudChrome.chatWindow.reset', () => this.deps.resetChatWindow());
      return true;
    }
    if (this.activeCategory === 'interface' && sectionId === 'unitFrames') {
      this.resetActionRow(parent, 'hudChrome.frameReset.label', () => this.deps.resetUnitFrames());
      return true;
    }
    return false;
  }

  private resetActionRow(parent: HTMLElement, labelKey: TranslationKey, onReset: () => void): void {
    const label = t(labelKey);
    const { row, control } = this.optRow(label);
    const btn = el('button', 'btn');
    btn.type = 'button';
    btn.textContent = t('hudChrome.chatWindow.resetAction');
    btn.addEventListener('click', () => {
      audio.click();
      onReset();
    });
    control.appendChild(btn);
    parent.appendChild(row);
  }

  /** Reset a set of settings keys to their defaults and re-apply to subsystems. */
  private resetKeys(keys: string[]): void {
    const hooks = this.deps.options();
    if (!hooks) return;
    for (const key of keys) {
      const bool = (BOOL_SETTINGS as Record<string, { def: boolean }>)[key];
      if (bool) {
        hooks.settings.set(key as BoolSettingKey, bool.def);
        hooks.onSettingChange(key as keyof GameSettings, bool.def);
      } else {
        const r = SETTING_RANGES[key as NumericSettingKey];
        if (!r) continue;
        hooks.settings.set(key as NumericSettingKey, r.def);
        hooks.onSettingChange(key as keyof GameSettings, r.def);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Interface: language + theme (bespoke, ported intact)
  // -------------------------------------------------------------------------

  private languageRow(parent: HTMLElement): void {
    const hooks = this.deps.options();
    if (!hooks) return;
    const { row, control } = this.optRow(t('hud.options.language'));
    const options = supportedLanguages.map((lang) => ({
      value: lang,
      label: LANGUAGE_ENDONYMS[lang],
    }));
    const status = document.createElement('span');
    status.className = 'visually-hidden';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    let busy = false;
    const dropdown = this.deps.buildDropdown(
      options,
      getLanguage(),
      (selected) => {
        if (busy || !isSupportedLanguage(selected) || selected === getLanguage()) return;
        audio.click();
        busy = true;
        void hooks
          .changeLanguage(selected, (msg) => {
            status.textContent = msg;
          })
          .then((ok) => {
            if (ok) {
              if (this.isOpen && this.activeCategory === 'interface' && this.subView === 'none') {
                this.renderDetail();
                this.deps.focusFirstInteractive(this.deps.root(), '.set-lang-select .ui-dd-btn');
              }
            } else {
              this.deps.setDropdownValue(dropdown, getLanguage());
            }
          })
          .catch(() => {
            status.textContent = t('settings.languageLoadFailed');
            this.deps.setDropdownValue(dropdown, getLanguage());
          })
          .finally(() => {
            busy = false;
          });
      },
      undefined,
      { ariaLabel: t('hud.options.language') },
    );
    dropdown.classList.add('set-lang-select');
    control.appendChild(dropdown);
    parent.append(row, status);
  }

  private themeRow(parent: HTMLElement): void {
    const hooks = this.deps.options();
    if (!hooks) return;
    const theme = hooks.theme;
    const { row, control } = this.optRow(t('hudChrome.theme.preset'));
    const seg = el('div', 'set-seg theme-presets');
    const presetLabel = (id: PresetId): string =>
      t(`hudChrome.theme.presets.${id}` as TranslationKey);
    for (const id of PRESET_ORDER) {
      const btn = el('button', 'btn set-seg-btn');
      btn.type = 'button';
      btn.textContent = presetLabel(id);
      btn.classList.toggle('active', theme.get().preset === id);
      btn.addEventListener('click', () => {
        audio.click();
        theme.setPreset(id);
        this.renderDetail();
      });
      seg.appendChild(btn);
    }
    control.appendChild(seg);
    parent.appendChild(row);

    // Custom palette: one colour input per knob, seeded with the effective value.
    const effective = resolveTheme(theme.get());
    const customCount = Object.keys(theme.get().custom).length;
    const customRow = el('div', 'set-row theme-custom-head');
    const customName = el('span', 'set-name');
    customName.textContent = t('hudChrome.theme.customColors');
    const reset = el('button', 'btn set-toggle');
    reset.type = 'button';
    reset.textContent = t('hudChrome.theme.reset');
    reset.disabled = customCount === 0;
    reset.addEventListener('click', () => {
      audio.click();
      theme.resetCustom();
      this.renderDetail();
    });
    customRow.append(customName, reset);
    parent.appendChild(customRow);

    const grid = el('div', 'theme-color-grid');
    for (const knob of THEME_KNOB_ORDER) {
      const knobRow = el('label', 'theme-color-row');
      const swatchLabel = document.createElement('span');
      swatchLabel.textContent = t(
        `hudChrome.theme.knob.${THEME_KNOB_LABEL_KEY[knob]}` as TranslationKey,
      );
      const input = document.createElement('input');
      input.type = 'color';
      input.value = effective[knob];
      input.setAttribute('aria-label', swatchLabel.textContent);
      input.addEventListener('input', () => theme.setCustom(knob, input.value));
      input.addEventListener('change', () => {
        theme.setCustom(knob, input.value);
        reset.disabled = false;
      });
      knobRow.append(input, swatchLabel);
      grid.appendChild(knobRow);
    }
    parent.appendChild(grid);
  }

  private renderGraphicsReload(parent: HTMLElement): void {
    const note = el('div', 'opt-note');
    note.textContent = t('hud.options.graphicsReloadNote');
    parent.appendChild(note);
    const reload = el('button', 'btn');
    reload.type = 'button';
    reload.textContent = t('hud.options.reloadNow');
    reload.addEventListener('click', () => {
      audio.click();
      location.reload();
    });
    parent.appendChild(reload);
  }

  // -------------------------------------------------------------------------
  // Overview landing
  // -------------------------------------------------------------------------

  private renderOverview(detail: HTMLElement): void {
    const head = el('div', 'opt-cat-head');
    head.textContent = t('hudChrome.options.ia.catOverviewName');
    const sub = el('div', 'opt-cat-sub');
    sub.textContent = t('hudChrome.options.ia.catOverviewSub');
    detail.append(head, sub);

    // Quick actions (mirror the footer).
    const quick = el('div', 'opt-quick');
    for (const action of OVERVIEW_QUICK_ACTIONS) {
      if (!this.quickActionAvailable(action.id)) continue;
      const cls =
        action.id === 'resume'
          ? 'btn is-primary'
          : action.id === 'logout' || action.id === 'resetAll'
            ? 'btn is-danger'
            : 'btn';
      const btn = el('button', cls);
      btn.type = 'button';
      btn.textContent = t(action.labelKey);
      btn.addEventListener('click', () => this.runQuickAction(action.id));
      quick.appendChild(btn);
    }
    detail.appendChild(quick);

    // Reload-pending alert (a graphics change that needs a reload was made).
    if (this.reloadPending) {
      const alert = el('div', 'opt-alert');
      const text = document.createElement('span');
      text.textContent = t('hud.options.graphicsReloadNote');
      const reload = el('button', 'btn');
      reload.type = 'button';
      reload.textContent = t('hud.options.reloadNow');
      reload.addEventListener('click', () => {
        audio.click();
        location.reload();
      });
      alert.append(text, reload);
      detail.appendChild(alert);
    }

    // Pinned essentials: mirror rows writing their HOME key (no second home).
    const hooks = this.deps.options();
    const source = hooks ? this.settingsSource(hooks) : null;
    const pinsSection = el('div', 'opt-section');
    const pinsHead = el('div', 'opt-section-head');
    const pinsTitle = document.createElement('span');
    pinsTitle.textContent = t('hudChrome.options.ia.catOverviewName');
    pinsHead.appendChild(pinsTitle);
    pinsSection.appendChild(pinsHead);
    for (const pin of OVERVIEW_PINS) {
      if (pin.nonSettingsHome === 'language') {
        this.languageRow(pinsSection);
      } else if (pin.nonSettingsHome === 'themePreset') {
        this.themeRow(pinsSection);
      } else if (pin.key && hooks && source) {
        const homeRow = settingRow(pin.key);
        if (!homeRow) continue;
        const control = buildControlFromRow(source, homeRow);
        if (control) this.applyControls(pinsSection, [control], hooks, () => this.render());
      }
      const crumb = el('div', 'opt-pin-home');
      const home = CATEGORIES.find((c) => c.id === pin.homeCategory);
      if (home) crumb.textContent = t(home.nameKey);
      pinsSection.appendChild(crumb);
    }
    detail.appendChild(pinsSection);

    // Status block: version, online/offline, total changed-from-defaults.
    const status = el('div', 'opt-status');
    const { version, build } = appVersionInfo();
    const ver = document.createElement('span');
    ver.textContent = t('hudChrome.options.version', { version, build });
    const mode = document.createElement('span');
    mode.textContent = this.online()
      ? t('hudChrome.options.modeOnline')
      : t('hudChrome.options.modeOffline');
    const changed = document.createElement('span');
    const n = hooks ? totalChangedCount((key) => this.isChanged(hooks, key)) : 0;
    changed.textContent = t('hudChrome.options.changedSummary', {
      count: formatNumber(n, { maximumFractionDigits: 0 }),
    });
    status.append(ver, mode, changed);
    detail.appendChild(status);
  }

  private quickActionAvailable(id: QuickActionId): boolean {
    if (id === 'reportBug') return this.deps.bugReport() !== null;
    // Logout stays reachable in both modes: offline logout reloads to the title
    // screen (a meaningful action), so today's unconditional reachability is kept.
    return true;
  }

  private runQuickAction(id: QuickActionId): void {
    audio.click();
    if (id === 'resume') {
      this.close();
    } else if (id === 'reportBug') {
      this.activeCategory = 'system';
      this.subView = 'bugreport';
      this.render();
    } else if (id === 'logout') {
      this.deps.options()?.logout();
    } else {
      this.confirmResetAll();
    }
  }

  // -------------------------------------------------------------------------
  // System: perf overlay (delegated) + support (bug report) + about
  // -------------------------------------------------------------------------

  private renderSystem(detail: HTMLElement): void {
    this.categoryHead(detail, 'system', 'hudChrome.options.ia.catSystemName');
    const sub = el('div', 'opt-cat-sub');
    sub.textContent = t('hudChrome.options.ia.catSystemSub');
    detail.appendChild(sub);

    // Performance: the delegated overlay config panel (its master toggle is
    // showFps). Placement drag stays gated to this category being open.
    const hooks = this.deps.options();
    if (hooks) {
      const perfHost = el('div', 'opt-perf-host');
      detail.appendChild(perfHost);
      this.perfSettings ??= new PerfOverlaySettingsPanel(this.perfSettingsHost(hooks));
      this.perfSettings.render(perfHost);
    }

    // Support: Report a Bug (online) pushes the bug-report sub-view.
    if (this.deps.bugReport() !== null) {
      const support = el('div', 'opt-section');
      const supportHead = el('div', 'opt-section-head');
      const supportTitle = document.createElement('span');
      supportTitle.textContent = t('hudChrome.options.sec.support');
      supportHead.appendChild(supportTitle);
      support.appendChild(supportHead);
      const { row, control } = this.optRow(t('hudChrome.bugReport.menuButton'));
      const btn = el('button', 'btn');
      btn.type = 'button';
      btn.textContent = t('hudChrome.bugReport.menuButton');
      btn.addEventListener('click', () => {
        audio.click();
        this.subView = 'bugreport';
        this.renderRail();
        this.renderDetail();
      });
      control.appendChild(btn);
      support.appendChild(row);
      detail.appendChild(support);
    }

    // About: the running build.
    const about = el('div', 'opt-section');
    const aboutHead = el('div', 'opt-section-head');
    const aboutTitle = document.createElement('span');
    aboutTitle.textContent = t('hudChrome.options.sec.about');
    aboutHead.appendChild(aboutTitle);
    about.appendChild(aboutHead);
    const { version, build } = appVersionInfo();
    const ver = el('div', 'opt-version');
    ver.textContent = t('hudChrome.options.version', { version, build });
    about.appendChild(ver);
    detail.appendChild(about);
  }

  private perfSettingsHost(hooks: OptionsHooks): PerfSettingsHost {
    return {
      perf: hooks.perfOverlay,
      getShowFps: () => hooks.settings.get('showFps'),
      setShowFps: (on) => hooks.onSettingChange('showFps', on),
      click: () => audio.click(),
      onClose: () => this.close(),
      onBack: () => this.setActiveCategory('overview'),
      closeIconHtml: svgIcon('close'),
      backIconHtml: svgIcon('prev'),
    };
  }

  // -------------------------------------------------------------------------
  // Footer
  // -------------------------------------------------------------------------

  private renderFooter(footer: HTMLElement): void {
    footer.replaceChildren();
    const resetAll = el('button', 'btn is-danger');
    resetAll.type = 'button';
    resetAll.textContent = t('hud.options.resetToDefaults');
    resetAll.addEventListener('click', () => {
      audio.click();
      this.confirmResetAll();
    });
    footer.appendChild(resetAll);

    const right = el('div', 'opt-footer-actions');
    if (this.deps.bugReport() !== null) {
      const bug = el('button', 'btn-ghost btn');
      bug.type = 'button';
      bug.textContent = t('hudChrome.bugReport.menuButton');
      bug.addEventListener('click', () => {
        audio.click();
        this.activeCategory = 'system';
        this.subView = 'bugreport';
        this.render();
      });
      right.appendChild(bug);
    }
    // Log out stays reachable offline (it reloads to the title screen).
    const logout = el('button', 'btn is-danger');
    logout.type = 'button';
    logout.textContent = t('hud.options.logout');
    logout.addEventListener('click', () => {
      audio.click();
      this.deps.options()?.logout();
    });
    right.appendChild(logout);

    const done = el('button', 'btn is-primary');
    done.type = 'button';
    done.textContent = t('hudChrome.options.done');
    done.addEventListener('click', () => this.close());
    right.appendChild(done);
    footer.appendChild(right);
  }

  private confirmResetAll(): void {
    const doReset = () => {
      this.deps.options()?.settings.reset();
      const all = this.deps.options()?.settings.all();
      if (all)
        for (const k of Object.keys(all) as (keyof GameSettings)[])
          this.deps.options()?.onSettingChange(k, all[k]);
      this.render();
    };
    if (this.deps.confirmDialog) {
      this.deps.confirmDialog(
        t('hudChrome.options.resetAllTitle'),
        t('hudChrome.options.resetAllBody'),
        t('hud.options.resetToDefaults'),
        t('game.talents.cancel'),
        doReset,
      );
    } else {
      doReset();
    }
  }

  // -------------------------------------------------------------------------
  // Search results (basic all-scope view: grouped rows + breadcrumb + go-to)
  // -------------------------------------------------------------------------

  private renderSearchResults(detail: HTMLElement, query: string): void {
    const hooks = this.deps.options();
    const head = el('div', 'opt-cat-head');
    head.textContent = t('hudChrome.options.searchScopeAll');
    detail.appendChild(head);
    if (!hooks) return;
    const source = this.settingsSource(hooks);
    const env = this.env();
    const matches = buildSearchIndex().filter((r) =>
      rowMatchesQuery(t(r.labelKey), r.settingKey, query),
    );
    // Group matches by home category, honoring env gating (hidden rows never surface).
    let total = 0;
    for (const cat of CATEGORIES) {
      const catMatches = matches.filter((m) => m.categoryId === cat.id);
      if (catMatches.length === 0) continue;
      const model = renderCategory(cat.id, env);
      const visibleKeys = new Set(
        model.sections.flatMap((s) => s.rows.map((r) => r.key).filter(Boolean)),
      );
      const rows = catMatches.filter((m) => visibleKeys.has(m.settingKey));
      if (rows.length === 0) continue;
      total += rows.length;
      const group = el('div', 'opt-result-group');
      const crumb = el('div', 'opt-result-crumb');
      const name = document.createElement('span');
      name.textContent = t(cat.nameKey);
      const goto = el('button', 'opt-goto');
      goto.type = 'button';
      goto.textContent = t('hudChrome.options.searchGoTo', { category: t(cat.nameKey) });
      goto.addEventListener('click', () => this.setActiveCategory(cat.id));
      crumb.append(name, goto);
      group.appendChild(crumb);
      for (const m of rows) {
        const row = settingRow(m.settingKey);
        if (!row) continue;
        const control = buildControlFromRow(source, row);
        if (control) this.applyControls(group, [control], hooks, () => this.render());
      }
      detail.appendChild(group);
    }
    if (total === 0) {
      const empty = el('div', 'opt-empty');
      empty.textContent = t('hudChrome.options.searchEmpty');
      detail.appendChild(empty);
    }
  }

  // -------------------------------------------------------------------------
  // Keybinds (bind table + reset; the rebind UX is unchanged, P4 owns polish)
  // -------------------------------------------------------------------------

  private actionDisplayName(actionId: string, fallback: string): string {
    if (!actionId.startsWith('slot'))
      return BIND_ACTION_LABEL_KEYS[actionId] ? t(BIND_ACTION_LABEL_KEYS[actionId]) : fallback;
    const slot = Number(actionId.slice(4));
    if (slot === 0) return t('hud.keybinds.actions.attack');
    return (
      this.deps.slotActionName(slot) ?? t('hud.keybinds.actions.actionBarSlot', { slot: slot + 1 })
    );
  }

  private renderKeybindTable(parent: HTMLElement): void {
    const hooks = this.deps.options();
    const note = el('div', 'kb-note');
    note.textContent = this.keybindNote || t('hud.options.keybindHelpMouseCamera');
    parent.appendChild(note);
    const cols = el('div', 'kb-cols');
    const attackMoveOn = !!hooks?.settings.get('attackMove');
    for (const category of BIND_CATEGORIES) {
      const visible = BIND_ACTIONS.filter(
        (a) => a.category === category && (a.id !== 'attackMove' || attackMoveOn),
      );
      if (visible.length === 0) continue;
      const col = el('div', 'kb-col');
      const header = el('div', 'kb-cat');
      header.textContent = BIND_CATEGORY_LABEL_KEYS[category]
        ? t(BIND_CATEGORY_LABEL_KEYS[category])
        : category;
      col.appendChild(header);
      const rows = el('div', 'kb-rows');
      for (const action of visible) {
        const row = el('div', 'kb-row');
        const name = el('span', 'kb-name');
        const label = el('span', 'kb-label');
        label.textContent = this.actionDisplayName(action.id, action.label);
        const hint = el('span', 'kb-inline-key');
        const primary = this.deps.keybinds().labelAt(action.id, 0);
        hint.textContent = primary ? `(${primary})` : '';
        name.append(label, hint);
        row.appendChild(name);
        for (let index = 0; index < 2; index++) {
          const capturing =
            this.capturingKey?.action === action.id && this.capturingKey?.index === index;
          const key = el('button', `btn kb-key${capturing ? ' capturing' : ''}`);
          key.type = 'button';
          key.textContent = capturing
            ? '...'
            : this.deps.keybinds().labelAt(action.id, index) || t('hud.options.unbound');
          key.title = index === 0 ? t('hud.options.primary') : t('hud.options.alternate');
          key.setAttribute(
            'aria-label',
            `${this.actionDisplayName(action.id, action.label)} ${key.title}`,
          );
          key.addEventListener('click', () => this.beginCapture(action.id, index, action.label));
          row.appendChild(key);
        }
        rows.appendChild(row);
      }
      col.appendChild(rows);
      cols.appendChild(col);
    }
    parent.appendChild(cols);
    const reset = el('button', 'btn');
    reset.type = 'button';
    reset.textContent = t('hud.options.resetToDefaults');
    reset.addEventListener('click', () => {
      audio.click();
      this.deps.keybinds().reset();
      this.capturingKey = null;
      this.keybindNote = t('hud.options.keybindReset');
      this.deps.refreshKeybindLabels();
      this.renderDetail();
    });
    parent.appendChild(reset);
  }

  private beginCapture(actionId: string, index: number, fallbackLabel: string): void {
    const hooks = this.deps.options();
    if (!hooks) return;
    const name = this.actionDisplayName(actionId, fallbackLabel);
    this.capturingKey = { action: actionId, index };
    this.keybindNote = t('hud.options.keybindCapture', { action: name });
    this.renderDetail();
    hooks.captureKey((code) => {
      this.capturingKey = null;
      if (code === null) {
        this.keybindNote = t('hud.options.keybindCancelled');
      } else if (this.deps.keybinds().bind(actionId, index, code)) {
        this.keybindNote = t('hud.options.keybindBound', {
          action: name,
          key: keyLabel(this.deps.keybinds().codeAt(actionId, index)),
        });
        this.deps.refreshKeybindLabels();
      } else if (isReservedCode(code)) {
        this.keybindNote = t('hud.options.keybindReserved', { key: keyLabel(code) });
      }
      if (this.isOpen && this.activeCategory === 'keybinds' && this.subView === 'none')
        this.renderDetail();
    });
  }

  // -------------------------------------------------------------------------
  // Controller per-button remap (bespoke .ui-dd dropdowns)
  // -------------------------------------------------------------------------

  private gamepadActionOptions(): { value: string; label: string }[] {
    const opts: { value: string; label: string }[] = [
      { value: GAMEPAD_NONE, label: t('hud.options.unbound') },
      { value: 'escape', label: t('hudChrome.controller.menuAction') },
    ];
    for (const a of BIND_ACTIONS) {
      if (a.id === 'attackMove') continue;
      if (a.kind !== 'edge' && a.id !== 'jump') continue;
      opts.push({ value: a.id, label: this.actionDisplayName(a.id, a.label) });
    }
    return opts;
  }

  private renderControllerButtons(parent: HTMLElement): void {
    const hooks = this.deps.options();
    if (!hooks) return;
    const head = el('div', 'opt-section-head');
    const title = document.createElement('span');
    title.textContent = t('hudChrome.controller.buttons');
    head.appendChild(title);
    parent.appendChild(head);
    const entries = hooks.gamepad.entries();
    if (entries.length === 0) {
      const empty = el('div', 'opt-empty');
      empty.textContent = t('hudChrome.controller.help');
      parent.appendChild(empty);
      return;
    }
    const opts = this.gamepadActionOptions();
    const kind = hooks.gamepad.kind();
    for (const { button, action } of entries) {
      const buttonLabel = gamepadButtonLabel(button, kind);
      const { row, control } = this.optRow(buttonLabel);
      const dd = this.deps.buildDropdown(
        opts,
        action,
        (v) => hooks.gamepad.bind(button, v),
        undefined,
        {
          ariaLabel: buttonLabel,
        },
      );
      control.appendChild(dd);
      parent.appendChild(row);
    }
    const reset = el('button', 'btn');
    reset.type = 'button';
    reset.textContent = t('hudChrome.controller.resetButtons');
    reset.addEventListener('click', () => {
      audio.click();
      hooks.gamepad.reset();
      this.renderDetail();
    });
    parent.appendChild(reset);
  }

  // -------------------------------------------------------------------------
  // Bug report (pushed sub-view under System > Support)
  // -------------------------------------------------------------------------

  private renderBugReport(detail: HTMLElement): void {
    const hooks = this.deps.bugReport();
    if (!hooks) {
      this.subView = 'none';
      this.activeCategory = 'system';
      this.renderDetail();
      return;
    }
    const head = el('div', 'opt-cat-head');
    head.textContent = t('hudChrome.bugReport.menuButton');
    detail.appendChild(head);
    const back = el('button', 'btn');
    back.type = 'button';
    back.textContent = t('hud.options.back');
    back.addEventListener('click', () => {
      audio.click();
      this.subView = 'none';
      this.renderRail();
      this.renderDetail();
    });
    detail.appendChild(back);

    const info = buildBugReportInfo(this.deps.world().realm, this.deps.world().player);
    const realm = info.realmKnown ? info.realm : t('hudChrome.bugReport.unknown');
    const coords =
      `${formatNumber(info.pos.x, { maximumFractionDigits: 0, useGrouping: false })}, ` +
      `${formatNumber(info.pos.y, { maximumFractionDigits: 0, useGrouping: false })}, ` +
      `${formatNumber(info.pos.z, { maximumFractionDigits: 0, useGrouping: false })}`;
    const infoEl = el('div', 'bug-info');
    const infoRow = (label: string, value: string): string =>
      `<div class="bug-info-row"><span class="bug-info-label">${esc(label)}</span><span class="bug-info-val">${esc(value)}</span></div>`;
    infoEl.innerHTML =
      infoRow(t('hudChrome.bugReport.realm'), realm) +
      infoRow(t('hudChrome.bugReport.character'), info.characterName) +
      infoRow(t('hudChrome.bugReport.position'), coords);
    detail.appendChild(infoEl);

    const shot = hooks.capture();
    const descLabel = el('label', 'bug-label');
    descLabel.setAttribute('for', 'bug-desc');
    descLabel.textContent = t('hudChrome.bugReport.description');
    const desc = document.createElement('textarea');
    desc.id = 'bug-desc';
    desc.className = 'bug-desc';
    desc.maxLength = BUG_DESC_MAX_LEN;
    desc.setAttribute('placeholder', t('hudChrome.bugReport.descriptionPlaceholder'));
    desc.setAttribute('aria-describedby', 'bug-error');
    detail.append(descLabel, desc);

    let includeShot = shot !== null;
    if (shot) {
      const shotWrap = el('div', 'bug-shot');
      const img = document.createElement('img');
      img.className = 'bug-shot-img';
      img.src = shot;
      img.alt = t('hudChrome.bugReport.screenshotAlt');
      const toggle = el('button', 'btn set-toggle');
      toggle.type = 'button';
      const syncToggle = () => {
        toggle.textContent = includeShot ? t('hud.options.on') : t('hud.options.off');
        toggle.classList.toggle('off', !includeShot);
        toggle.setAttribute('aria-pressed', String(includeShot));
        toggle.setAttribute('aria-label', t('hudChrome.bugReport.includeScreenshot'));
        img.style.display = includeShot ? '' : 'none';
      };
      toggle.addEventListener('click', () => {
        audio.click();
        includeShot = !includeShot;
        syncToggle();
      });
      syncToggle();
      const toggleRow = el('div', 'set-row');
      const name = el('span', 'set-name');
      name.textContent = t('hudChrome.bugReport.includeScreenshot');
      toggleRow.append(name, toggle);
      shotWrap.append(toggleRow, img);
      detail.appendChild(shotWrap);
    }

    const error = el('div', 'report-error');
    error.id = 'bug-error';
    error.setAttribute('role', 'alert');
    detail.appendChild(error);

    const actions = el('div', 'report-actions');
    const submit = el('button', 'btn');
    submit.type = 'button';
    submit.textContent = t('hudChrome.bugReport.submit');
    actions.appendChild(submit);
    detail.appendChild(actions);

    submit.addEventListener('click', () => {
      const description = desc.value.trim();
      if (!description) {
        error.textContent = t('hudChrome.bugReport.describeFirst');
        return;
      }
      submit.disabled = true;
      error.textContent = '';
      const sentShot = includeShot && shot !== null;
      hooks
        .submit({ description, screenshot: includeShot ? shot : null, meta: hooks.collectMeta() })
        .then(({ screenshotStored }) => {
          const droppedShot = sentShot && !screenshotStored;
          this.deps.log(
            t(
              droppedShot ? 'hudChrome.bugReport.submittedNoShot' : 'hudChrome.bugReport.submitted',
            ),
          );
          this.subView = 'none';
          this.renderRail();
          this.renderDetail();
        })
        .catch((err: unknown) => {
          submit.disabled = false;
          error.textContent = this.localizeBugReportError(err);
        });
    });
    window.setTimeout(() => desc.focus(), 0);
  }

  private localizeBugReportError(err: unknown): string {
    const text = err instanceof Error ? err.message : '';
    const keyByMessage: Record<string, TranslationKey> = {
      'describe the bug': 'hudChrome.bugReport.describeFirst',
      'bug report too large': 'hudChrome.bugReport.tooLarge',
      'too many bug reports, try again later': 'hudChrome.bugReport.rateLimited',
    };
    const key = keyByMessage[text.toLowerCase()];
    return key ? t(key) : t('hudChrome.bugReport.failed');
  }
}
