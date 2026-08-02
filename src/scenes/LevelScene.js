import Phaser from 'phaser';
import { music, MusicEngine } from '../core/MusicEngine.js';
import { Conductor } from '../core/Conductor.js';
import { generateChart } from '../core/ChartGen.js';
import { PhraseScore, JUDGMENTS } from '../core/Judge.js';
import { CombatResolver } from '../core/CombatResolver.js';
import { SkillEngine } from '../core/SkillEngine.js';
import { saveManager } from '../core/SaveManager.js';
import { makeEnemy } from '../data/enemies.js';
import { PET_BY_ID } from '../data/pets.js';
import { TopHUD, ENEMY_STATE } from '../ui/TopHUD.js';
import { BottomHUD } from '../ui/BottomHUD.js';
import { playSlash } from '../ui/SlashFX.js';
import { STAGE } from '../core/Layout.js';
import { COLORS, CSS, TYPE, FONT, css } from '../core/Theme.js';
import { getMiniGame, visibleBeatsForLevel } from '../minigames/MiniGame.js';
import '../minigames/BallHop.js';
import { stopMenuBgm } from '../core/Bgm.js';
import '../minigames/OsuCircles.js';

/**
 * LevelScene — one song, one fight.
 *
 * Phrases alternate enemy (you block) -> hero (you attack). The song length IS
 * the fight length; if the enemy is still standing when the chart runs out, we
 * go to Sudden Death where all damage in both directions is tripled.
 */
export class LevelScene extends Phaser.Scene {
  constructor() { super('Level'); }

  init(data) {
    this.run = data.run;
    this.enemy = makeEnemy(this.run.level);
    this.chart = generateChart(this.run.level, this.run.diffTier);
    this.phraseIndex = -1;
    this.phrase = null;
    this.score = new PhraseScore();
    this.suddenDeath = false;
    this.finished = false;
    this.accelerando = 0;
    this._lastHalfTime = false;
    // Phaser reuses scene instances, so every latch has to be cleared here.
    this._kickerUsed = false;
    this._bossPhaseIndex = 0;
  }

  create() {
    const { width: W, height: H } = this.scale;
    this.cameras.main.setBackgroundColor(CSS.bg);

    // ---- full-screen stage between the two HUD bars (DESIGN.md §2) ----
    this.stageBounds = STAGE;

    // ---- core wiring ----
    this.conductor = new Conductor(music);
    this.skills = new SkillEngine(this.run, this.conductor);
    this.skills.fx = (text, color) => this.floatText(text, color);
    this.combat = new CombatResolver(this.run, this.enemy, this.skills, this.conductor);

    this.combat.onEnemyDamaged = (amt, crit) => this.onEnemyDamaged(amt, crit);
    this.combat.onHeroDamaged = (amt) => this.onHeroDamaged(amt);
    this.combat.onShielded = () => this.showShielded();
    this.combat.onHeroDied = () => this.endLevel(false);
    this.combat.onEnemyDied = () => this.endLevel(true);

    // ---- HUD (DESIGN.md §2) ----
    this.topHud = new TopHUD(this, this.run, this.enemy);
    this.bottomHud = new BottomHUD(this, this.run);
    this.bottomHud.onCast = (id) => this.castSkill(id);

    const MG = getMiniGame(this.chart.minigame);
    this.minigame = new MG(this, this.stageBounds, this.conductor, {
      onJudged: (j, n) => this.onJudged(j, n),
      onNoteSpawn: () => this.skills.onNoteSpawn(this.phrase?.type),
      onGateCrossed: (gate) => this.onGateCrossed(gate),
      onLensCollected: (amount) => this.onLensCollected(amount),
      visibleBeats: visibleBeatsForLevel(this.run.level),
      level: this.run.level,
    });
    this.minigame.create();
    this.minigame.setSpeedTier(this.run.diffTier);
    this.minigame.setCombo?.(this.run.combo);
    this.updateGate();
    // Show the opening phrase during the lead-in, so the road is already
    // populated before the first gate arrives.
    this.minigame.setUpcoming(this.chart.phrases[0] || null);

    this.buildHud();

    // ---- keyboard skill casting ----
    this.input.keyboard.on('keydown', (e) => {
      const map = { '1': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5, '7': 6, '8': 7, '9': 8, '0': 9 };
      if (e.key in map) {
        const id = this.run.skills[map[e.key]];
        if (id) this.castSkill(id);
      }
      if (e.key === 'Escape') this.confirmQuit();
    });

    // ---- start the song ----
    // Menu BGM must be off: the battle synth (with combo layering) owns the
    // audio here, and two tracks at once is exactly what players hate.
    stopMenuBgm();
    this.conductor.onBeat = (b) => this.onBeat(b);
    music.start(MusicEngine.makeSong(this.run.level));
    this.conductor.reset();

    this.bottomHud.refresh();
    this.topHud.refresh();

    this.events.once('shutdown', () => {
      music.stop();
      this.minigame?.destroy();
    });
  }

  buildHud() {
    const { width: W, height: H } = this.scale;
    const b = this.stageBounds;

    // judgment text pops just above the ball plane (DESIGN §5.5)
    this.judgeText = this.add.text(
      b.x + b.width / 2,
      b.y + b.height * 0.30, '', {
      ...TYPE.judgment, color: '#ffffff',
    }).setOrigin(0.5).setAlpha(0);

    // banners sit above the horizon (DESIGN §5.6)
    this.bannerText = this.add.text(
      b.x + b.width / 2,
      b.y + b.height * 0.12, '', {
      ...TYPE.banner, color: CSS.amber,
    }).setOrigin(0.5).setAlpha(0);
    this._hitStopUntil = 0;
  }

  // ------------------------------------------------------------- phrase flow

  startNextPhrase() {
    this.phraseIndex++;
    if (this.phraseIndex >= this.chart.phrases.length) {
      this.enterSuddenDeath();
      return;
    }
    this.phrase = this.chart.phrases[this.phraseIndex];
    this.score.reset();
    this.combat.beginPhrase();
    this._kickerUsed = false;   // Kicker pet gets one free PERFECT per phrase

    const isEnemy = this.phrase.type === 'enemy';

    // ORDER MATTERS: enemy skills must resolve BEFORE startPhrase(), because
    // Mirror flips the lanes and startPhrase is what maps notes onto them.
    // Running these the other way round makes Mirror silently do nothing.
    if (isEnemy) this.maybeEnemySkill();
    this.applySpeedModifiers();
    this.minigame.startPhrase(this.phrase);

    this.topHud.setPhrase(
      `LEVEL ${this.run.level}  ·  PHRASE ${this.phraseIndex + 1}/${this.chart.phrases.length}  ·  ` +
      `${isEnemy ? 'DEFEND' : 'ATTACK'}  ·  ${this.phrase.archetype}` +
      (this.minigame.mirrored ? '  ·  MIRRORED' : '') +
      (this.run.stageDamageMult > 1 ? `  ·  DMG ×${this.run.stageDamageMult.toFixed(2)}` : ''),
      isEnemy ? COLORS.enemy : COLORS.hero);

    this.topHud.setState(isEnemy ? ENEMY_STATE.WINDUP : ENEMY_STATE.IDLE, 500);
    this.bottomHud.setMode(this.phrase.type);

    // DESIGN §5.9 intent telegraph: show the enemy's next skill one phrase early
    // (StS Intents lesson — tell the player what is coming before it lands).
    if (!isEnemy) {
      const skl = this.enemy.skills;
      const nextIdx = this.phraseIndex + 1;
      if (skl.length && nextIdx % 3 === 0 && this.run.silencePhrases <= 0) {
        this.topHud.showIntent(skl[Math.floor(nextIdx / 3) % skl.length]);
      } else {
        this.topHud.showIntent(null);
      }
    }
    this.updateGate();
    // Hand the minigame the NEXT phrase so the road continues past the gate
    // instead of stopping dead at it every 16 beats.
    this.minigame.setUpcoming(this.chart.phrases[this.phraseIndex + 1] || null);
  }

  /**
   * Point the track's mode gate at the NEXT phrase boundary.
   *
   * The gate is a full-width bar the ball always crosses — red for the enemy's
   * turn, green for yours. Before this existed the mode simply flipped between
   * phrases with a text banner, which meant the rules changed under the player
   * mid-flow with no warning. Now the change is something you watch approach
   * and physically pass through.
   */
  updateGate() {
    // Never replace a gate the ball has not reached yet. Phrase 0 is started a
    // beat EARLY so its notes have room to approach, which meant indexing off
    // phraseIndex swapped the opening gate out from under the player one beat
    // before they crossed it — it visibly vanished. Advancing only once the
    // current gate is spent is both simpler and immune to that.
    const current = this.minigame.gate;
    if (current && !current.crossed) return;

    const beat = this.conductor.beat;
    const next = this.chart.phrases.find((p) => p.startBeat > beat - 0.01);
    this.minigame.setGate(next ? { beat: next.startBeat, type: next.type } : null);
  }

  /** The ball just passed through a mode gate. */
  onGateCrossed(gate) {
    const isEnemy = gate.type === 'enemy';
    this.showBanner(isEnemy ? 'DEFEND' : 'ATTACK', isEnemy ? 0xff4d6d : 0x8bff5e);
    music.sfx(isEnemy ? 'gateEnemy' : 'gateHero');
    this.cameras.main.flash(140, isEnemy ? 90 : 20, isEnemy ? 20 : 90, isEnemy ? 45 : 50);
  }

  onLensCollected(amount = 1) {
    this.run.lens = Math.max(0, Math.floor(this.run.lens || 0) + Math.max(0, amount));
    this.bottomHud?.refresh();
  }

  /**
   * Recompute the minigame's approach speed from every active modifier.
   * Called on phrase start and whenever a skill is cast — this is the single
   * place that turns skill state into something the player can actually feel.
   */
  applySpeedModifiers() {
    let mult = 1;
    // Half Time: notes take 40% longer to arrive.
    if (this.run.halfTimeActive) mult *= 1.4;
    // Tempo Thief: only slows the enemy's phrases, never your own attack phrases.
    if (this.phrase?.type === 'enemy' && this.run.tempoTheft > 0) {
      mult *= 1 + this.run.tempoTheft;
    }
    // Enemy Accelerando stacks permanently for the level. Tracked here rather
    // than by poking setSpeedTier directly, because this method overwrites the
    // tier every call and would otherwise erase it.
    if (this.accelerando > 0) mult /= 1 + this.accelerando * 0.18;

    this.minigame.setSpeedMultiplier(mult);
    this.minigame.setSpeedTier(this.run.diffTier);
    this._lastHalfTime = this.run.halfTimeActive;
  }

  /** Pet Feast: fire the pet's special right now instead of waiting. */
  consumePetFeast() {
    if (!this.run.petFeastPending || !this.run.pet) return;
    this.run.petFeastPending = false;
    const pet = PET_BY_ID[this.run.pet.id];
    switch (pet?.special) {
      case 'mana':
        this.run.addMana(8);
        this.floatText('+8 MANA', 0xa78bfa);
        break;
      case 'burn': {
        const d = this.combat.applyPetBurn() * 3;
        this.combat.applyToEnemy(d, true);
        this.floatText(`BURN ${Math.round(d)}`, 0xffd166);
        break;
      }
      case 'autohit':
        this._kickerUsed = false;   // refresh the free PERFECT
        this.floatText('KICKER READY', 0xff9f43);
        break;
      case 'highlight':
        this.minigame.setJam(-1);   // Metro clears any active Jam
        this.floatText('NOTES REVEALED', 0x5ef2ff);
        break;
      case 'echo':
        if (this.combat.lastHitAmount > 0) {
          this.combat.applyToEnemy(this.combat.lastHitAmount * 2, true);
          this.floatText('ECHO x2', 0x9be15d);
        }
        break;
      default:
        // Fang has no special; give it something rather than eating the mana.
        this.combat.applyToEnemy(this.run.atk * 1.5, true);
        this.floatText('FANG BITE', 0xff3860);
        break;
    }
  }

  finishPhrase() {
    if (!this.phrase) return;
    this.minigame.endPhrase();

    const acc = Math.max(this.score.accuracy, this.skills.accuracyFloor(this.phraseIndex));

    if (this.phrase.type === 'enemy') {
      const counter = this.combat.counterAttack(acc);
      if (counter > 0) {
        this.showBanner('PERFECT BLOCK — COUNTER!', 0x5ef2ff);
        this.floatText(`COUNTER ${Math.round(counter)}`, 0x5ef2ff);
        music.sfx('skill');
      }
    }

    this.combat.applyPetBurn();
    this.combat.endPhrase(this.phrase, this.score);

    // Wisp pet mana trickle
    const pet = this.run.pet ? PET_BY_ID[this.run.pet.id] : null;
    if (pet?.special === 'mana') this.run.addMana(2);

    this.phrase = null;
    this.bottomHud.refresh();
    this.topHud.refresh();
  }

  maybeEnemySkill() {
    if (this.run.silencePhrases > 0) {
      this.topHud.setSkillLabel('SILENCED');
      return;
    }
    const skills = this.enemy.skills;
    if (!skills.length) return;
    if (this.phraseIndex % 3 !== 0) return;

    const sk = skills[Math.floor(this.phraseIndex / 3) % skills.length];
    this.topHud.setSkillLabel(`${sk.name}: ${sk.desc}`);
    this.topHud.setState(ENEMY_STATE.CAST, 600);
    this.topHud.showTelegraph(sk.name.toUpperCase());

    switch (sk.id) {
      case 'shield':
        this.enemy.def = this.enemy.baseDef + 40;
        this.enemy.shieldPhrases = 2;
        this.time.delayedCall(800, () => {
          if (!this.finished && this.enemy.shieldPhrases > 0) {
            this.topHud.setState(ENEMY_STATE.DEFENSE);
          }
        });
        break;
      case 'accelerando':
        this.accelerando = Math.min(4, (this.accelerando || 0) + 1);
        break;
      case 'curse':
        this.run.curseNext = true;
        break;
      case 'mend': {
        if (this.run.avgAccuracy < 0.70) {
          const h = this.enemy.maxHp * 0.10;
          this.enemy.hp = Math.min(this.enemy.maxHp, this.enemy.hp + h);
          this.floatText(`ENEMY +${Math.round(h)}`, 0x8bff5e);
        }
        break;
      }
      case 'jam':
        // Hide the notes for 4 beats — you keep playing, but by ear only.
        this.minigame.setJam(this.conductor.beat + 8);
        this.floatText('NOTES HIDDEN — PLAY BY EAR', 0x868e96);
        break;
      case 'mirror':
        // Flip the lanes for this phrase. Applied before startPhrase maps notes.
        this.minigame.setMirror(true);
        this.floatText('LANES MIRRORED', 0xa78bfa);
        break;
      case 'hidden':
        // Osu's Hidden keeps the hit object readable only near its timing
        // point, while removing the approach-circle forecast.
        this.minigame.setHidden?.(this.conductor.beat + 8);
        this.floatText('HIDDEN OBJECTS', 0xa78bfa);
        break;
      case 'flashlight':
        // Flashlight is a cursor-centred visibility cone. It is movement-only,
        // so it never asks the player to press a button.
        this.minigame.setFlashlight?.(this.conductor.beat + 8);
        this.floatText('FLASHLIGHT', 0x5ef2ff);
        break;
      default: break;
    }
    this.topHud.refresh();
  }

  enterSuddenDeath() {
    if (this.suddenDeath) { this.endLevel(false); return; }
    this.suddenDeath = true;
    this.showBanner('SUDDEN DEATH — ALL DAMAGE x3', 0xff3860);
    music.sfx('death');

    // One tier harder, then rebuild a fresh set of phrases at the new density.
    this.run.diffTier = Math.min(3, this.run.diffTier + 1);
    this.minigame.setSpeedTier(this.run.diffTier);
    const extra = generateChart(this.run.level, this.run.diffTier);
    const base = this.chart.phrases.length;
    this.chart.phrases.push(...extra.phrases.slice(0, 2).map((p, i) => ({
      ...p,
      index: base + i,
      startBeat: this.conductor.beat + 4 + i * 16,
    })));

    // startNextPhrase() increments before reading, and it already incremented us
    // past the end to get here — step back so the first overtime phrase is not
    // silently skipped.
    this.phraseIndex--;
    this.startNextPhrase();
  }

  // ------------------------------------------------------------- events

  onBeat(beat) {
    this.topHud.onBeat();
    this.bottomHud.onBeat();

    if (this.finished) return;
    this.updateGate();   // no-op while the current gate is still approaching

    // start the first phrase once the lead-in has passed
    if (!this.phrase && this.phraseIndex < 0 && beat >= this.chart.leadInBeats - 1) {
      this.startNextPhrase();
      return;
    }
    if (!this.phrase) return;

    const end = this.phrase.startBeat + this.phrase.lengthBeats;
    if (beat >= end) {
      this.finishPhrase();
      this.startNextPhrase();
    }
  }

  onJudged(judgment, note) {
    let j = this.skills.filterJudgment(judgment, this.enemy);

    // Kicker pet: one free PERFECT per phrase
    const pet = this.run.pet ? PET_BY_ID[this.run.pet.id] : null;
    if (pet?.special === 'autohit' && j.name === 'MISS' && !this._kickerUsed) {
      this._kickerUsed = true;
      j = JUDGMENTS.PERFECT;
    }

    if (j.weight > 0) {
      this.run.addCombo();
      // Pass the combo so the hit note climbs the song's scale — a clean streak
      // plays an ascending melody rather than the same beep over and over.
      music.hit(j.name, this.run.combo);
      // GAME_PLAN A1: every 8 consecutive hits adds one arrangement layer;
      // a miss strips them all (music.setComboLayer(0) below).
      music.setComboLayer(Math.min(4, Math.floor(this.run.combo / 8)));
      // DESIGN §6.3: combo milestones pop every 25 hits.
      if (this.run.combo % 25 === 0) {
        music.sfx('milestone');
        this.tweens.add({
          targets: this.topHud.comboText, scale: 1.4, duration: 90, yoyo: true,
        });
        this.topHud.comboText.setColor(CSS.cyan);
        this.time.delayedCall(320, () =>
          this.topHud.comboText.setColor(CSS.amber));
      }
    } else {
      this.run.breakCombo();
      music.hit('MISS');
      music.setComboLayer(0);
      // DESIGN §6.3: a broken combo greys the counter and thuds.
      music.sfx('comboBreak');
      this.tweens.add({
        targets: this.topHud.comboText, alpha: 0.5, duration: 120, yoyo: true,
      });
    }
    // BallHop owns the visual/speed response to a sustained streak; the run
    // state remains the single source of truth for combo count.
    this.minigame.setCombo?.(this.run.combo);
    this.score.add(j, this.run.combo);

    if (this.phrase?.type === 'hero') {
      const dmg = this.combat.resolveHeroNote(j);
      if (dmg > 0) {
        this.bottomHud.playAttack(); // ASSETS.md §6 hero attack anim
      }
    } else {
      this.combat.resolveEnemyNote(j);
      if (j.weight <= 0) this.topHud.setState(ENEMY_STATE.ATTACK, 300);
    }

    this.showJudgment(j);
    this.bottomHud.refresh();
    this.topHud.refresh();
  }

  onEnemyDamaged(amount, crit) {
    const hpPct = this.enemy.maxHp > 0 ? this.enemy.hp / this.enemy.maxHp : 0;
    if (this.enemy.isBoss) {
      const nextPhase = hpPct <= 0.33 ? 2 : hpPct <= 0.66 ? 1 : 0;
      if (nextPhase > this._bossPhaseIndex) {
        this._bossPhaseIndex = nextPhase;
        this.topHud.setState(ENEMY_STATE.PHASE_CHANGE);
      } else if (crit) {
        this.topHud.setState(ENEMY_STATE.STUN);
      } else {
        this.topHud.setState(ENEMY_STATE.HURT);
      }
    } else if (crit) {
      this.topHud.setState(ENEMY_STATE.STUN);
    } else {
      this.topHud.setState(ENEMY_STATE.HURT);
    }
    // Blade sweep across the enemy avatar — the player's hit lands (DESIGN §5.8).
    playSlash(this, this.topHud.avatarX, this.topHud.avatarY, {
      accent: crit ? COLORS.amber : COLORS.cyan,
      length: 140,
    });
    // Damage numbers pop beside the enemy avatar in the top HUD (DESIGN §5.8).
    const t = this.add.text(
      this.topHud.avatarX + 36 + Phaser.Math.Between(-14, 14),
      this.topHud.avatarY - 4,
      `-${Math.round(amount)}`, {
      fontFamily: FONT.display, fontSize: crit ? '22px' : '16px', fontStyle: '700',
      color: crit ? CSS.amber : CSS.magenta,
    }).setOrigin(0.5);
    this.tweens.add({
      targets: t, y: t.y - 52, alpha: 0, duration: 650,
      onComplete: () => t.destroy(),
    });
    if (crit) {
      this.cameras.main.shake(90, 0.004);
      // DESIGN §6.4 hit-stop: freeze the frame 40ms on a big hit, then resume.
      // The audio clock is Web Audio's own, so a skipped frame cannot desync.
      this._hitStopUntil = performance.now() + 40;
    }
  }

  onHeroDamaged(amount) {
    this.topHud.setState(ENEMY_STATE.ATTACK);
    // Blade sweep across the hero avatar — the enemy's strike lands.
    playSlash(this, this.bottomHud.avatarX, this.bottomHud.avatarY, {
      accent: COLORS.enemy,
      length: 150,
    });
    this.bottomHud.flashHurt();
    this.cameras.main.shake(140, 0.006);
    music.sfx('hurt');
    const t = this.add.text(this.bottomHud.avatarX + 42, this.bottomHud.avatarY, `-${Math.round(amount)}`, {
      fontFamily: FONT.display, fontSize: '19px', fontStyle: '700', color: CSS.enemy,
    }).setOrigin(0.5);
    this.tweens.add({
      targets: t, y: t.y - 40, alpha: 0, duration: 600,
      onComplete: () => t.destroy(),
    });
  }

  castSkill(id) {
    if (this.finished) return;
    const idx = this.run.skills.indexOf(id);
    const result = this.skills.cast(id, this.enemy);
    if (result.ok) {
      music.sfx('skill');
      this.bottomHud.castFlash(idx);
      // Half Time / Tempo Thief / Hurry all change how fast notes arrive, so
      // recompute the whole speed picture rather than just the tier.
      this.applySpeedModifiers();
      this.consumePetFeast();
    } else if (result.reason === 'mana') {
      this.floatText('NOT ENOUGH MANA', 0xff4d6d);
      music.sfx('miss');
    }
    this.bottomHud.refresh();
    this.topHud.refresh();
    if (this.enemy.hp <= 0 && !this.finished) this.endLevel(true);
  }

  // ------------------------------------------------------------- feedback

  showJudgment(j) {
    // OsuCircles renders compact feedback directly beneath each target. The
    // shared centre banner is retained for Ball Hop, where it does not cover
    // an active mouse target.
    if (this.minigame?.constructor?.id === 'osu') return;
    this.judgeText.setText(j.name).setTint(j.color).setAlpha(1).setScale(1.25);
    this.tweens.killTweensOf(this.judgeText);
    this.tweens.add({ targets: this.judgeText, scale: 1, alpha: 0, duration: 420, ease: 'Quad.easeOut' });
  }

  showBanner(text, color) {
    this.bannerText.setText(text).setTint(color).setAlpha(1).setScale(0.8);
    this.tweens.killTweensOf(this.bannerText);
    this.tweens.add({ targets: this.bannerText, scale: 1, duration: 200 });
    this.tweens.add({ targets: this.bannerText, alpha: 0, delay: 900, duration: 400 });
  }

  floatText(text, color) {
    const b = this.stageBounds;
    const t = this.add.text(b.x + b.width / 2, b.y + b.height * 0.6, text, {
      fontFamily: FONT.display, fontSize: '19px', fontStyle: '700',
    }).setOrigin(0.5).setTint(color);
    this.tweens.add({
      targets: t, y: t.y - 60, alpha: 0, duration: 900,
      onComplete: () => t.destroy(),
    });
  }

  /**
   * GAME_PLAN C9 soft-punishment buffer: the phrase's first MISS was absorbed.
   * The miss still broke combo / accuracy / music layers — only the damage is
   * spared — so the feedback is a warm golden ring, not a full pardon.
   */
  showShielded() {
    this.topHud.setState(ENEMY_STATE.DEFENSE, 800);
    const b = this.stageBounds;
    const x = b.x + b.width / 2, y = b.y + b.height * 0.6;
    const ring = this.add.circle(x, y, 26, 0x000000, 0)
      .setStrokeStyle(3, COLORS.amber, 0.9);
    this.tweens.add({
      targets: ring, scale: 2.2, alpha: 0, duration: 480, ease: 'Quad.easeOut',
      onComplete: () => ring.destroy(),
    });
    this.floatText('SHIELDED', COLORS.amber);
    music.sfx('shield');
  }

  // ------------------------------------------------------------- end

  endLevel(won) {
    if (this.finished) return;
    this.finished = true;
    music.stop();
    this.minigame.endPhrase();

    if (won) {
      this.topHud.setState(ENEMY_STATE.DEATH, 900);
      music.sfx('death');
      this.showBanner('ENEMY DOWN', 0x8bff5e);
      this.run.onLevelClear();
      saveManager.saveRun(this.run);
      this.time.delayedCall(1500, () => {
        if (this.run.level >= 20) this.scene.start('GameOver', { run: this.run, cleared: true, won: true });
        else this.scene.start('Upgrade', { run: this.run });
      });
    } else {
      this.topHud.setState(ENEMY_STATE.VICTORY);
      this.bottomHud.flashHurt();
      this.showBanner('YOU FELL', 0xff4d6d);
      music.sfx('death');
      this.time.delayedCall(1400, () =>
        this.scene.start('GameOver', { run: this.run, cleared: false, won: false }));
    }
  }

  confirmQuit() {
    if (this.finished) return;
    this.finished = true;
    music.stop();
    this.scene.start('GameOver', { run: this.run, cleared: false, won: false, quit: true });
  }

  // ------------------------------------------------------------- loop

  update() {
    // DESIGN §6.4: during hit-stop the frame freezes — nothing updates, the
    // audio keeps flowing, and the next frame simply lands where the clock is.
    if (performance.now() < this._hitStopUntil) return;

    this.conductor.update();
    this.minigame.update();
    this.topHud.update();

    if (this.enemy.shieldPhrases <= 0 && this.topHud.state === ENEMY_STATE.DEFENSE) {
      this.topHud.setState(ENEMY_STATE.IDLE);
    }

    // Half Time expires on a timer, not on a phrase boundary, so the speed has
    // to be recomputed the moment it lapses — otherwise the notes stay slow for
    // the rest of the phrase and the skill is strictly better than intended.
    if (this._lastHalfTime !== this.run.halfTimeActive) this.applySpeedModifiers();

    if (this.phrase) {
      const acc = this.score.accuracy;
      this.topHud.accText.setText(`${(acc * 100).toFixed(1)}%  ${this.score.rank}`);
      this.topHud.accText.setColor(css(
        acc >= 0.9 ? COLORS.hero : acc >= 0.8 ? COLORS.amber : COLORS.enemy));
      this.topHud.comboText.setText(
        this.run.combo > 0 ? `COMBO ${this.run.combo}  ×${this.run.comboMult.toFixed(2)}` : '');
    }

    if (this.conductor.isPlaying) {
      const remaining = (this.chart.totalBeats - this.conductor.beat) * this.conductor.msPerBeat / 1000;
      if (remaining > 0 && !this.suddenDeath) {
        this.bottomHud.timeText.setText(`${Math.max(0, remaining).toFixed(0)}s of song left`);
      } else {
        this.bottomHud.timeText.setText(this.suddenDeath ? 'SUDDEN DEATH' : '');
      }
    }
  }
}
