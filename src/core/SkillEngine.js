/**
 * SkillEngine — the only place that knows how to run a skill.
 *
 * Combat code never checks "is skill X equipped". It calls a hook and the engine
 * fans it out to whatever the player happens to be carrying. That is what keeps
 * 24 skills from turning CombatResolver into a pile of if-statements.
 */
import { SKILL_BY_ID } from '../data/skills.js';
import { JUDGMENTS } from './Judge.js';

export class SkillEngine {
  constructor(run, conductor) {
    this.run = run;
    this.conductor = conductor;
    this.fx = null; // set by LevelScene: (text, color) => void
  }

  get active() { return this.run.skillObjects; }

  _ctx(extra = {}) {
    return {
      run: this.run, conductor: this.conductor, fx: this.fx,
      JUD: JUDGMENTS, ...extra,
    };
  }

  /** Attempt to cast an active/toggle skill. Returns a result for the UI. */
  cast(skillId, enemy) {
    const skill = SKILL_BY_ID[skillId];
    if (!skill || !skill.cast) return { ok: false, reason: 'passive' };

    let cost = skill.cost;
    if (this.run.curseNext) { cost *= 2; }

    if (this.run.mana < cost) {
      // Soul Trade lets you pay with HP when mana runs dry
      if (this.run.hasSkill('soul_trade')) {
        const deficit = cost - this.run.mana;
        const hpCost = Math.ceil(deficit / 2);
        if (this.run.hp > hpCost + 1) {
          this.run.mana = 0;
          this.run.damage(hpCost);
          this.fx?.(`SOUL TRADE -${hpCost} HP`, 0xff3860);
          const ok = skill.cast(this._ctx({ enemy }));
          if (ok) this.run.curseNext = false;
          return { ok, soulTraded: true };
        }
      }
      return { ok: false, reason: 'mana' };
    }

    const ok = skill.cast(this._ctx({ enemy }));
    if (ok) {
      this.run.mana -= cost;
      this.run.curseNext = false;
    }
    return { ok, reason: ok ? null : 'failed' };
  }

  /** Let passives rewrite a judgment (Ghost Note, Shield Loop). */
  filterJudgment(judgment, enemy) {
    let result = judgment;
    for (const s of this.active) {
      if (!s.onNoteJudged) continue;
      const out = s.onNoteJudged(this._ctx({ judgment: result, enemy }));
      if (out && out.judgment) result = out.judgment;
    }
    return result;
  }

  onNoteSpawn(phraseType) {
    for (const s of this.active) s.onNoteSpawn?.(this._ctx({ phraseType }));
  }

  /** Multiplier applied to all outgoing damage (Last Stand, Half Time). */
  outgoingMultiplier(enemy) {
    let m = 1;
    for (const s of this.active) {
      if (s.modifyOutgoing) m *= s.modifyOutgoing(this._ctx({ enemy }));
    }
    return m;
  }

  /** Per-hit rewrite of outgoing damage (Double Down, Chorus Echo, Vampire Beat). */
  transformDamageDealt(amount, judgment, enemy) {
    let a = amount;
    for (const s of this.active) {
      if (s.onDamageDealt) a = s.onDamageDealt(this._ctx({ amount: a, judgment, enemy }));
    }
    return a;
  }

  /** Per-hit rewrite of incoming damage (Respawn Happier, Double Down). */
  transformDamageTaken(amount, enemy) {
    let a = amount;
    for (const s of this.active) {
      if (s.onDamageTaken) a = s.onDamageTaken(this._ctx({ amount: a, enemy }));
    }
    return a;
  }

  /** Returns true if a passive saved the player from death. */
  tryPreventDeath() {
    for (const s of this.active) {
      if (s.onLethal && s.onLethal(this._ctx())) return true;
    }
    return false;
  }

  onPhraseEnd(phrase, score, enemy) {
    for (const s of this.active) s.onPhraseEnd?.(this._ctx({ phrase, score, enemy }));
  }

  /** Cold Open's accuracy floor for the opening phrase. */
  accuracyFloor(phraseIndex) {
    if (phraseIndex === 0 && this.run.hasSkill('cold_open')) return 0.6;
    return 0;
  }
}
