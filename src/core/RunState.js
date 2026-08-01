/**
 * RunState — everything about the current run. Dies with the run (permadeath);
 * only Shards survive into the meta layer.
 */
import { SKILL_BY_ID } from '../data/skills.js';
import { petMultiplier, PET_BY_ID } from '../data/pets.js';

export const BASE = { hp: 100, mana: 30, def: 0, atk: 20 };
export const GAIN = { hp: 12, mana: 5, def: 4, atk: 3 };
export const POINTS_PER_LEVEL = 3;

export const DIFF_NAMES = ['Chill', 'Normal', 'Hurry', 'Frenzy'];
export const DIFF_ATK = [1.0, 1.30, 1.60, 2.00];
export const DIFF_RISK = [1.0, 1.45, 2.00, 2.80];

export class RunState {
  constructor(seed = Date.now()) {
    this.seed = seed;
    this.level = 1;
    this.points = { hp: 0, mana: 0, def: 0, atk: 0 };
    this.unspentPoints = 0;

    this.skills = [];        // array of skill ids, max 10
    this.pet = null;         // { id, level }
    this.diffTier = 1;       // starts on Normal

    this.hp = this.maxHp;
    this.mana = 0;
    this.combo = 0;
    this.maxComboThisLevel = 0;
    // Lens are earned only when Boost is active and the player lands a tile.
    // They are transient run loot and are converted into the existing meta
    // Shards when the run ends, so the unlock economy stays in one currency.
    this.lens = 0;

    // transient per-run flags used by skills
    this.secondWindUsed = false;
    this.ghostCharges = 0;
    this.mirrorPhrases = 0;
    this.silencePhrases = 0;
    this.dissonancePhrases = 0;
    // Skill timers are stored as wall-clock deadlines (performance.now() + ms)
    // rather than beat numbers. RunState has no reference to the Conductor, and
    // an earlier version stored beats here that nothing could read — which is
    // exactly how Overclock ended up doing nothing at all.
    this.overclockUntil = 0;
    this.halfTimeUntil = 0;
    this.bassCharge = 0;
    this.tempoTheft = 0;
    this.perfectStreak = 0;
    this.echoCount = 0;
    this.happierBudget = 0;
    this.loopUsed = false;
    // Soft-punishment buffer (GAME_PLAN C9): the first missed note of every
    // phrase deals no damage. Independent of Shield Loop, which also protects
    // the combo — this one only spares the HP.
    this.missShieldUsed = false;
    this.maxHpPenalty = 0;
    this.invulnUntil = 0;
    this.lastPhraseDamage = 0;
    this.petFeastPending = false;
    this.curseNext = false;

    this.totalDamageDealt = 0;
    this.accuracyHistory = [];
  }

  // ------------------------------------------------------------- derived stats
  get maxHp() {
    const raw = BASE.hp + this.points.hp * GAIN.hp;
    return Math.round(raw * (1 - (this.maxHpPenalty || 0)));
  }
  get maxMana() { return BASE.mana + this.points.mana * GAIN.mana; }
  get def() {
    let d = BASE.def + this.points.def * GAIN.def;
    const petBase = this.pet ? PET_BY_ID[this.pet.id] : null;
    if (petBase?.defPenalty) d *= (1 - petBase.defPenalty);
    return d;
  }
  get atk() { return BASE.atk + this.points.atk * GAIN.atk; }

  get diffName() { return DIFF_NAMES[this.diffTier]; }
  get diffAtk() { return DIFF_ATK[this.diffTier]; }
  get diffRisk() { return DIFF_RISK[this.diffTier]; }
  get petMult() { return petMultiplier(this.pet); }

  /** Diminishing-returns damage reduction, capped well below immortality. */
  get defReduction() { return this.def / (this.def + 100); }

  get overclockActive() { return performance.now() < this.overclockUntil; }
  get halfTimeActive() { return performance.now() < this.halfTimeUntil; }

  get comboMult() {
    // Overclock halves the notes-per-step, so the multiplier climbs twice as fast.
    const rate = this.overclockActive ? 12 : 25;
    return Math.min(4.0, 1.0 + Math.floor(this.combo / rate) * 0.25);
  }

  get isAlive() { return this.hp > 0; }
  get avgAccuracy() {
    if (!this.accuracyHistory.length) return 1;
    return this.accuracyHistory.reduce((a, b) => a + b, 0) / this.accuracyHistory.length;
  }

  // ------------------------------------------------------------- mutation
  hasSkill(id) { return this.skills.includes(id); }
  get skillObjects() { return this.skills.map((id) => SKILL_BY_ID[id]).filter(Boolean); }

  addSkill(id) {
    if (this.skills.length >= 10 || this.hasSkill(id)) return false;
    this.skills.push(id);
    SKILL_BY_ID[id]?.onAcquire?.({ run: this });
    return true;
  }

  removeSkill(id) {
    const i = this.skills.indexOf(id);
    if (i >= 0) this.skills.splice(i, 1);
  }

  spendPoint(stat) {
    if (this.unspentPoints <= 0 || !(stat in this.points)) return false;
    const beforeMax = this.maxHp;
    this.points[stat]++;
    this.unspentPoints--;
    if (stat === 'hp') this.hp += this.maxHp - beforeMax; // new HP is granted, not just capacity
    return true;
  }

  grantLevelPoints() {
    const bonus = this.hasSkill('greed_chord') ? 1.25 : 1.0;
    this.unspentPoints += Math.round(POINTS_PER_LEVEL * bonus);
  }

  heal(amount) {
    if (amount <= 0) return 0;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    return this.hp - before;
  }

  damage(amount) {
    if (amount <= 0) return 0;
    if (performance.now() < this.invulnUntil) return 0;
    const before = this.hp;
    this.hp = Math.max(0, this.hp - amount);
    return before - this.hp;
  }

  addMana(amount) {
    this.mana = Math.max(0, Math.min(this.maxMana, this.mana + amount));
  }

  /** Mana carries between levels but only tops up 50% on clear — scarcity is the point. */
  onLevelClear() {
    this.addMana(this.maxMana * 0.5);
    this.level++;
    this.grantLevelPoints();
    this.diffTier = Math.min(this.diffTier, 1); // Hurry resets each level
    this.resetPhraseFlags();
    this.bassCharge = 0;
    this.tempoTheft = 0;
  }

  resetPhraseFlags() {
    this.mirrorPhrases = Math.max(0, this.mirrorPhrases - 1);
    this.silencePhrases = Math.max(0, this.silencePhrases - 1);
    this.dissonancePhrases = Math.max(0, this.dissonancePhrases - 1);
    this.loopUsed = false;
    this.missShieldUsed = false;
  }

  breakCombo() { this.combo = 0; }
  addCombo() {
    this.combo++;
    if (this.combo > this.maxComboThisLevel) this.maxComboThisLevel = this.combo;
  }

  serialize() {
    return {
      seed: this.seed, level: this.level, points: { ...this.points },
      unspentPoints: this.unspentPoints, skills: [...this.skills],
      pet: this.pet ? { ...this.pet } : null, hp: this.hp, mana: this.mana,
      lens: this.lens,
      secondWindUsed: this.secondWindUsed, maxHpPenalty: this.maxHpPenalty,
      totalDamageDealt: this.totalDamageDealt,
    };
  }

  static deserialize(data) {
    const r = new RunState(data.seed);
    Object.assign(r, {
      level: data.level, points: data.points, unspentPoints: data.unspentPoints,
      skills: data.skills || [], pet: data.pet || null,
      lens: Math.max(0, Math.floor(data.lens || 0)),
      secondWindUsed: !!data.secondWindUsed, maxHpPenalty: data.maxHpPenalty || 0,
      totalDamageDealt: data.totalDamageDealt || 0,
    });
    r.hp = Math.min(data.hp ?? r.maxHp, r.maxHp);
    r.mana = Math.min(data.mana ?? 0, r.maxMana);
    return r;
  }
}
