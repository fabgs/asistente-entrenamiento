import {
  ACCENTS,
  buildColors,
  contrast,
  DEFAULT_THEME,
  mix,
  over,
  parseThemePreference,
  themeLabel,
  withAlpha,
  type Palette,
  type ThemeMode,
} from '../palette';

const MODES: ThemeMode[] = ['dark', 'light'];
const themes = MODES.flatMap((mode) => ACCENTS.map((a) => ({ mode, accent: a.key })));

describe('the colours of the app', () => {
  it('keeps the dark green it always had as the default', () => {
    const colors = buildColors(DEFAULT_THEME);
    expect(colors.primary).toBe('#4ADE80');
    expect(colors.onPrimary).toBe('#0B1A10');
    expect(colors.up).toBe(colors.primary);
    expect(colors.primaryTint).toBe('rgba(74, 222, 128, 0.14)');
    expect(colors.primaryTintOnMap).toBe('rgba(74, 222, 128, 0.20)');
    expect(colors.accent).toBe('#60A5FA');
    expect(colors.accentTint).toBe('rgba(96, 165, 250, 0.14)');
    expect(colors.chart).toBe('#16A34A');
    expect(colors.bg).toBe('#0E1116');
  });

  it('moves «in progress» to teal with the blue accent, so the two are never the same blue', () => {
    for (const mode of MODES) {
      const blue = buildColors({ mode, accent: 'blue' });
      expect(blue.accent).not.toBe(blue.primary);
      expect(blue.intensityLow).toBe(blue.accent);
      expect(blue.accent).toBe(buildColors({ mode, accent: 'teal' }).primary);
      for (const accent of ['green', 'teal', 'pink'] as const) {
        expect(buildColors({ mode, accent }).accent).toBe(buildColors({ mode, accent: 'green' }).accent);
        expect(buildColors({ mode, accent }).accent).not.toBe(buildColors({ mode, accent }).primary);
      }
    }
  });

  describe.each(themes)('$mode · $accent', (theme) => {
    const c = buildColors(theme);
    /** Contrast of `color` on surfaces given from the bottom up (a tint over a card), flattened. */
    const on = (color: string, ...under: string[]) => contrast(color, under.reduce((below, top) => over(top, below)));

    it('reads its text', () => {
      expect(contrast(c.text, c.bg)).toBeGreaterThanOrEqual(7);
      expect(contrast(c.text, c.card)).toBeGreaterThanOrEqual(7);
      for (const surface of [c.bg, c.card, c.cardAlt]) expect(contrast(c.muted, surface)).toBeGreaterThanOrEqual(4.5);
    });

    it('reads the accent as a text, on its tint and under its own text', () => {
      for (const surface of [c.bg, c.card]) expect(contrast(c.primary, surface)).toBeGreaterThanOrEqual(4.5);
      expect(on(c.primary, c.card, c.primaryTint)).toBeGreaterThanOrEqual(4.5);
      // The selected segment: the accent on its tint on cardAlt, the hardest case.
      expect(on(c.primary, c.cardAlt, c.primaryTint)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.onPrimary, c.primary)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.chart, c.card)).toBeGreaterThanOrEqual(3);
    });

    it('reads every state colour on the surfaces and on its tint', () => {
      const states: [keyof Palette, keyof Palette][] = [
        ['accent', 'accentTint'],
        ['warning', 'warningTint'],
        ['danger', 'dangerTint'],
        ['muscleText', 'muscleTint'],
      ];
      for (const [color, tint] of states) {
        for (const surface of [c.bg, c.card]) expect(contrast(c[color], surface)).toBeGreaterThanOrEqual(4.5);
        expect(on(c[color], c.card, c[tint])).toBeGreaterThanOrEqual(4.5);
      }
    });

    it('steps the body map away from the card, one hue', () => {
      const steps = [c.heat1, c.heat2, c.heat3, c.heat4].map((h) => contrast(h, c.card));
      for (let i = 1; i < steps.length; i++) expect(steps[i] / steps[i - 1]).toBeGreaterThanOrEqual(1.3);
      expect(steps[0]).toBeGreaterThanOrEqual(2.4);
    });

    it('tells the walked paths apart level by level', () => {
      // Lighter with heat on the dark map (up to a vivid red, not a salmon), darker on the light one.
      const lum = [c.trail1, c.trail2, c.trail3, c.trail4].map((t) => contrast(t, theme.mode === 'dark' ? '#000000' : '#FFFFFF'));
      for (let i = 1; i < lum.length; i++) expect(lum[i] / lum[i - 1]).toBeGreaterThanOrEqual(1.25);
    });
  });

  it('reads what is stored, and falls back to the default', () => {
    expect(parseThemePreference('{"mode":"light","accent":"pink"}')).toEqual({ mode: 'light', accent: 'pink' });
    expect(parseThemePreference('{"mode":"sepia","accent":"lime"}')).toEqual(DEFAULT_THEME);
    expect(parseThemePreference('{"accent":"teal"}')).toEqual({ mode: 'dark', accent: 'teal' });
    for (const bad of [null, undefined, '', 'no', 'null', '7']) expect(parseThemePreference(bad)).toEqual(DEFAULT_THEME);
  });

  it('names a theme and mixes colours', () => {
    expect(themeLabel(DEFAULT_THEME)).toBe('Oscuro · Verde');
    expect(themeLabel({ mode: 'light', accent: 'teal' })).toBe('Claro · Turquesa');
    expect(withAlpha('#4ADE80', 0.14)).toBe('rgba(74, 222, 128, 0.14)');
    expect(over('rgba(255, 255, 255, 0.5)', '#000000')).toBe('#808080');
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
  });
});
