/**
 * Theme — the single source of truth for every colour, font and type size.
 *
 * DESIGN.md §3 (palette) and §4 (typography). Nothing in src/ may hardcode a
 * colour or font size that belongs here. Scene code should read from COLORS /
 * CSS / TYPE / FONT.
 *
 * COLORS.*  = Phaser number (0xRRGGBB) — for graphics, tint, setFillStyle...
 * CSS.*     = '#rrggbb' string            — for text color / backgroundColor...
 */

// ------------------------------------------------------------- palette

const H = {
  // --- background & panels (§3.1) ---
  bg: 0x07070d,        // global background
  panel: 0x0a0a14,     // HUD bars / panel fill
  card: 0x12121f,      // cards / list items
  stroke: 0x24243c,    // panel stroke (1px)
  strokeHi: 0x33334f,  // hover / selected stroke
  divider: 0x1a1a2e,   // dividers

  // --- semantic (§3.2) ---
  hero: 0x2bff88,      // hero phrase / block success / HP
  enemy: 0xff3b6b,     // enemy phrase / MISS / damage taken
  cyan: 0x00d4ff,      // neutral accent / MP / PERFECT / selected / links
  magenta: 0xff2fd6,   // danger accent / enemy skill icons / debuffs
  amber: 0xffd166,     // warning / gold rewards / crits / combo milestones
  violet: 0xa78bfa,    // DEF / skill accents (offers, loadout)
  orange: 0xff9f43,    // ATK / damage numbers / risk accents

  // --- judgment (§3.3) ---
  perfect: 0x5ef2ff,
  great: 0x8bff5e,
  good: 0xffe45e,
  miss: 0xff4d6d,

  // --- text (§3.4) ---
  textPrimary: 0xe8e6f0,   // off-white — never pure white for big text
  textSecondary: 0x8f8fae,
  textDim: 0x5a5a80,
  textFaint: 0x33334f,

  // --- stage themes (§3.5) ---
  skyHero: 0x04140c,
  skyEnemy: 0x180410,
  sunHero: 0x7dffb4,
  sunEnemy: 0xff9ab4,
  glowHero: 0x9dffc6,
  glowEnemy: 0xffa8c0,
  gateAttack: 0x14ff7a,
  gateDefend: 0xff1f57,
};

export const COLORS = H;

export const CSS = Object.fromEntries(
  Object.entries(H).map(([k, v]) => [k, '#' + v.toString(16).padStart(6, '0')]));

/** Phaser number -> '#rrggbb' string. */
export const css = (hexInt) => '#' + hexInt.toString(16).padStart(6, '0');

// ------------------------------------------------------------- fonts

export const FONT = {
  display: 'Orbitron',   // titles, big numbers (combo / judgment / banners)
  body: 'Rajdhani',      // body, labels, buttons, bar text
  logo: 'Monoton',       // logo / one-word accents only
};

// ------------------------------------------------------------- type scale (§4)

export const TYPE = {
  display: { fontFamily: FONT.display, fontSize: '58px', fontStyle: '900' },   // scene titles
  logo: { fontFamily: FONT.logo, fontSize: '76px' },                          // boot logo
  hudNumber: { fontFamily: FONT.display, fontSize: '30px', fontStyle: '700' },// combo etc.
  judgment: { fontFamily: FONT.display, fontSize: '38px', fontStyle: '700' }, // PERFECT
  judgmentGreat: { fontFamily: FONT.display, fontSize: '34px', fontStyle: '700' },
  judgmentGood: { fontFamily: FONT.display, fontSize: '30px', fontStyle: '700' },
  banner: { fontFamily: FONT.display, fontSize: '28px', fontStyle: '700' },
  hudLabel: { fontFamily: FONT.body, fontSize: '16px', fontStyle: '600' },
  body: { fontFamily: FONT.body, fontSize: '19px', fontStyle: '400' },
  caption: { fontFamily: FONT.body, fontSize: '15px', fontStyle: '400' },
  keyHint: { fontFamily: FONT.body, fontSize: '13px', fontStyle: '600' },
};

/** Fallback stack for @font-face preload (BootScene). */
export const FONT_STACK = {
  display: `'Orbitron', 'Trebuchet MS', sans-serif`,
  body: `'Rajdhani', 'Trebuchet MS', sans-serif`,
  logo: `'Monoton', 'Trebuchet MS', sans-serif`,
};
