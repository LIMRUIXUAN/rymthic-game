/**
 * CombatResolver — turns judgments into HP changes, in both directions.
 * The base formulas are verified in tools/balance_sim.py. The stageDamageMult
 * term is the endless-route escalation layered on after stage 8.
 *
 *   dealt = ... x DIFF_ATK x stageDamageMult x (1 - enemyDefRed)
 *   taken = enemyATK x K_IN x DIFF_RISK x stageDamageMult x (1 - heroDefRed)
 */
import { PET_BY_ID } from '../data/pets.js';

export const K_OUT = 0.25;
export const K_IN = 0.10;

export class CombatResolver {
  constructor(run, enemy, skills, conductor) {
    this.run = run;
    this.enemy = enemy;
    this.skills = skills;
    this.conductor = conductor;

    this.onEnemyDamaged = null;  // (amount, isCrit) => void
    this.onHeroDamaged = null;   // (amount) => void
    this.onShielded = null;      // () => void — first MISS of a phrase was absorbed
    this.onHeroDied = null;
    this.onEnemyDied = null;

    this.phraseDamage = 0;
    this.lastHitAmount = 0;
  }

  get enemyDefReduction() {
    const d = this.enemy.def;
    return d / (d + 100);
  }

  /** Damage for one successfully hit note during a HERO phrase. */
  resolveHeroNote(judgment) {
    if (judgment.weight <= 0) return 0;

    let dmg = this.run.atk
      * K_OUT
      * judgment.weight
      * this.run.comboMult
      * this.run.petMult
      * this.run.diffAtk
      * this.run.stageDamageMult
      * (1 - this.enemyDefReduction);

    dmg *= this.skills.outgoingMultiplier(this.enemy);
    dmg = this.skills.transformDamageDealt(dmg, judgment, this.enemy);

    // Echo pet: small chance to repeat the previous hit
    const pet = this.run.pet ? PET_BY_ID[this.run.pet.id] : null;
    if (pet?.special === 'echo' && Math.random() < 0.10 && this.lastHitAmount > 0) {
      dmg += this.lastHitAmount;
    }

    this.lastHitAmount = dmg;
    this.applyToEnemy(dmg, judgment.name === 'PERFECT');
    return dmg;
  }

  /** Damage taken for one note missed during an ENEMY phrase. */
  resolveEnemyNote(judgment) {
    if (judgment.weight > 0) {
      // Blocked. Mirror Shield reflects part of what you stopped.
      if (this.run.mirrorPhrases > 0) {
        const blocked = this.enemy.atk * K_IN * this.run.diffRisk * this.run.stageDamageMult;
        this.applyToEnemy(blocked * 0.4, false);
      }
      return 0;
    }

    // Soft-punishment buffer (GAME_PLAN C9): the first miss of each phrase is
    // absorbed — no damage, but the combo/accuracy/music penalties of the miss
    // already applied upstream. Shield Loop is a separate, stronger layer that
    // rewrites the judgment itself, so it never reaches this branch.
    if (!this.run.missShieldUsed) {
      this.run.missShieldUsed = true;
      this.onShielded?.();
      return 0;
    }

    let dmg = this.enemy.atk * K_IN * this.run.diffRisk
      * this.run.stageDamageMult * (1 - this.run.defReduction);
    if (this.run.dissonancePhrases > 0) dmg *= 0.7;

    dmg = this.skills.transformDamageTaken(dmg, this.enemy);
    this.applyToHero(dmg);
    return dmg;
  }

  applyToEnemy(amount, isCrit = false) {
    if (amount <= 0) return;
    this.enemy.hp = Math.max(0, this.enemy.hp - amount);
    this.phraseDamage += amount;
    this.run.totalDamageDealt += amount;
    this.onEnemyDamaged?.(amount, isCrit);
    if (this.enemy.hp <= 0) this.onEnemyDied?.();
  }

  applyToHero(amount) {
    if (amount <= 0) return;
    const actual = this.run.damage(amount);
    // Give the stage-8 -> stage-9 transition one grace hit. Later damage can
    // still kill normally, so this only prevents an immediate transition loss.
    if (this.run.level >= 9 && !this.run.postStage8GraceUsed && this.run.hp <= 0) {
      this.run.hp = 1;
      this.run.postStage8GraceUsed = true;
    }
    if (actual > 0) this.onHeroDamaged?.(actual);
    if (this.run.hp <= 0) {
      if (this.skills.tryPreventDeath()) return;
      this.onHeroDied?.();
    }
  }

  /** Perfect block on an enemy phrase earns a free counter-attack. */
  counterAttack(accuracy) {
    if (accuracy < 0.95) return 0;
    const dmg = this.run.atk * K_OUT * 8
      * this.run.comboMult * this.run.petMult * this.run.diffAtk * this.run.stageDamageMult
      * (1 - this.enemyDefReduction) * 0.5;
    this.applyToEnemy(dmg, true);
    return dmg;
  }

  /** Cinder pet burn, applied at phrase end. */
  applyPetBurn() {
    const pet = this.run.pet ? PET_BY_ID[this.run.pet.id] : null;
    if (pet?.special !== 'burn') return 0;
    const dmg = this.enemy.maxHp * 0.02 * this.run.stageDamageMult;
    this.applyToEnemy(dmg, false);
    return dmg;
  }

  beginPhrase() { this.phraseDamage = 0; }

  endPhrase(phrase, score) {
    if (phrase.type === 'hero') this.run.lastPhraseDamage = this.phraseDamage;
    // Mana income: a stronger baseline plus accuracy scaling, so Mana upgrades
    // remain useful without making skills unlimited.
    const acc = score.accuracy;
    this.run.addMana(6 + 14 * acc * acc);
    this.run.accuracyHistory.push(acc);
    this.skills.onPhraseEnd(phrase, score, this.enemy);
    this.run.resetPhraseFlags();
    if (this.enemy.shieldPhrases > 0) {
      this.enemy.shieldPhrases--;
      if (this.enemy.shieldPhrases === 0) this.enemy.def = this.enemy.baseDef;
    }
    return this.phraseDamage;
  }
}
