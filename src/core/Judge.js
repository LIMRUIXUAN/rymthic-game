/**
 * Judge — converts timing error into a judgment.
 * Windows shrink as difficulty rises, which is the real cost of Hurry/Frenzy.
 */

export const JUDGMENTS = {
  PERFECT: { name: 'PERFECT', window: 45,  weight: 1.00, mana: 1.0, color: 0x5ef2ff },
  GREAT:   { name: 'GREAT',   window: 90,  weight: 0.75, mana: 0.6, color: 0x8bff5e },
  GOOD:    { name: 'GOOD',    window: 135, weight: 0.40, mana: 0.2, color: 0xffe45e },
  MISS:    { name: 'MISS',    window: Infinity, weight: 0, mana: 0, color: 0xff4d6d },
};

export const ORDER = [JUDGMENTS.PERFECT, JUDGMENTS.GREAT, JUDGMENTS.GOOD];

/**
 * Judgment windows by difficulty tier.
 *
 * Normal is the 1.0 baseline. Chill is deliberately MORE forgiving — an earlier
 * version used pow(0.85, max(0, tier-1)), which gave Chill and Normal identical
 * windows and made the easy tier easier in name only.
 */
const WINDOW_SCALE = [1.25, 1.0, 0.85, 0.7225];

export function windowScale(tierIndex) {
  return WINDOW_SCALE[tierIndex] ?? 1.0;
}

/** Largest window still active — past this a note is a definite miss. */
export function missThreshold(tierIndex) {
  return JUDGMENTS.GOOD.window * windowScale(tierIndex);
}

/**
 * @param {number} errorMs  signed ms from the note's ideal time (negative = early)
 * @param {number} tierIndex 0 Chill, 1 Normal, 2 Hurry, 3 Frenzy
 */
export function judge(errorMs, tierIndex = 1) {
  const abs = Math.abs(errorMs);
  const scale = windowScale(tierIndex);
  for (const j of ORDER) {
    if (abs <= j.window * scale) return j;
  }
  return JUDGMENTS.MISS;
}

/** Running accuracy tracker for one phrase. */
export class PhraseScore {
  constructor() { this.reset(); }

  reset() {
    this.counts = { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 };
    this.weightSum = 0;
    this.total = 0;
    this.maxCombo = 0;
    this.manaEarned = 0;
  }

  add(judgment, combo) {
    this.counts[judgment.name]++;
    this.weightSum += judgment.weight;
    this.total++;
    this.manaEarned += judgment.mana;
    if (combo > this.maxCombo) this.maxCombo = combo;
  }

  /** 0..1. An empty phrase counts as perfect so it can never punish you. */
  get accuracy() { return this.total === 0 ? 1 : this.weightSum / this.total; }
  get missCount() { return this.counts.MISS; }

  get rank() {
    const a = this.accuracy;
    if (a >= 0.99) return 'S+';
    if (a >= 0.95) return 'S';
    if (a >= 0.90) return 'A';
    if (a >= 0.80) return 'B';
    if (a >= 0.70) return 'C';
    return 'D';
  }
}
