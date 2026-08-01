/**
 * Enemy table — generated from the same formulas as tools/balance_sim.py.
 * If you change a coefficient here, change it there too and re-run the sim.
 */
import { notesPerPhrase, phrasePairs } from '../core/ChartGen.js';

export const BOSS_LEVELS = new Set([5, 10, 15, 20]);

export const ENEMY_NAMES = {
  1: 'Tin Drummer',      2: 'Snare Sprite',      3: 'Hi-Hat Harpy',
  4: 'Kick Golem',       5: 'THE CONDUCTOR',     6: 'Bassline Wraith',
  7: 'Loop Fiend',       8: 'Reverb Ghoul',      9: 'Clipping Beast',
  10: 'THE MIXER',       11: 'Sine Serpent',     12: 'Glitch Imp',
  13: 'Sidechain Stalker', 14: 'Distortion Djinn', 15: 'THE PRODUCER',
  16: 'Null Chorus',     17: 'Phase Reaper',     18: 'Silence Warden',
  19: 'Feedback Titan',  20: 'THE ENCORE',
};

export const ENEMY_COLORS = {
  1: 0x8b6f47,  2: 0x6fa8dc,  3: 0xa78bfa,  4: 0x94743c,  5: 0xffd166,
  6: 0x6d4c9f,  7: 0x4ba3c3,  8: 0x7c6f9f,  9: 0xc75c5c, 10: 0xff9f43,
  11: 0x4fd1c5, 12: 0x9be15d, 13: 0x5c7cfa, 14: 0xf06595, 15: 0xffd43b,
  16: 0x868e96, 17: 0x845ef7, 18: 0x4c6ef5, 19: 0xff6b6b, 20: 0xff3860,
};

// Enemy skills, unlocking as the run goes on
const SKILL_POOL = [
  { id: 'jam',          name: 'Jam',          desc: 'Note graphics hidden for 4 beats' },
  { id: 'mirror',       name: 'Mirror',       desc: 'Lanes flip mid-phrase' },
  { id: 'accelerando',  name: 'Accelerando',  desc: 'Scroll speed permanently up' },
  { id: 'shield',       name: 'Shield',       desc: '+40 DEF for 2 phrases' },
  { id: 'mend',         name: 'Mend',         desc: 'Heals if your accuracy drops' },
  { id: 'curse',        name: 'Curse',        desc: 'Your next skill costs double' },
];

export function enemySkillsFor(level) {
  if (level < 3) return [];
  const out = [];
  const count = level >= 12 ? 2 : 1;
  for (let i = 0; i < count; i++) {
    const idx = (level * 3 + i * 5) % SKILL_POOL.length;
    out.push(SKILL_POOL[idx]);
  }
  return out;
}

export function enemyAtk(level) {
  return 14 * Math.pow(1.12, level - 1) * (BOSS_LEVELS.has(level) ? 1.4 : 1.0);
}

export function enemyDef(level) {
  return 3 * (level - 1) + (BOSS_LEVELS.has(level) ? 20 : 0);
}

/**
 * Enemy HP is DERIVED from expected player output rather than hand-picked, so
 * the curve can never silently drift away from the player's power curve.
 * Mirrors output() in tools/balance_sim.py — change one, change both.
 *
 * THE ASSUMPTIONS MATTER MORE THAN THE FORMULA.
 * The first version used combo = 2.5 and pet = 1.15, which describes a player
 * who never drops a combo and always has a companion. No pet is even OFFERED
 * until level 3, and combo resets on every single miss — so real output ran
 * 28-37% under the model, and every enemy was inflated by exactly that much.
 * That is why fights dragged.
 *
 * These are now deliberately CONSERVATIVE: a competent player with no pet and
 * an interrupted combo. Anyone doing better than that melts the enemy, which is
 * the correct reward for playing well rather than the baseline expectation.
 */
const ASSUMED_COMBO = 1.8;   // realistic average, not a flawless run
const ASSUMED_PET = 1.0;     // no pet — pets are a bonus, not a baseline

function expectedOutput(level, acc = 0.90) {
  const pts = (level - 1) * 3;
  const atk = 20 + Math.round(pts * 0.25) * 3;
  const K_OUT = 0.25, DIFF_ATK = 1.3;
  const defRed = 1 - enemyDef(level) / (enemyDef(level) + 100);
  return notesPerPhrase(level) * atk * K_OUT * acc
    * ASSUMED_COMBO * ASSUMED_PET * DIFF_ATK * defRed * phrasePairs(level);
}

export function enemyHp(level) {
  // Fraction of a competent player's full-song output. Below 1.0 so the fight
  // ends before the music does, leaving room to recover from a bad phrase.
  const factor = BOSS_LEVELS.has(level) ? 0.88 : 0.72;
  return Math.round((expectedOutput(level) * factor) / 10) * 10;
}

export function bpmForLevel(level) {
  return Math.round(96 + (level - 1) * (84 / 19));
}

export function makeEnemy(level) {
  return {
    level,
    name: ENEMY_NAMES[level] || `Anomaly ${level}`,
    color: ENEMY_COLORS[level] || 0xff5555,
    isBoss: BOSS_LEVELS.has(level),
    maxHp: enemyHp(level),
    hp: enemyHp(level),
    atk: enemyAtk(level),
    def: enemyDef(level),
    baseDef: enemyDef(level),
    bpm: bpmForLevel(level),
    skills: enemySkillsFor(level),
    shieldPhrases: 0,
  };
}
