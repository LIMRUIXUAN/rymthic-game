/**
 * MiniGame — the contract every stage game implements.
 *
 * The combat layer NEVER knows which minigame is running. It only listens for
 * judgment events. That is the whole design: adding a slap game or a rhythm-2048
 * later means writing one file in this folder and registering it below — nothing
 * in CombatResolver, RunState, or LevelScene changes.
 *
 * If you ever find yourself adding `if (minigame === 'osu')` to combat code,
 * the abstraction has leaked and should be fixed here instead.
 */
import { LANES } from '../core/ChartGen.js';

/** How many beats of road are visible normally. Spans past the mode gate. */
export const VISIBLE_BEATS = 7.5;
/** How many beats are visible while the enemy's Jam is active. */
export const JAM_REVEAL_BEATS = 4;

/**
 * GAME_PLAN B5: the sight-distance dial (osu!'s AR).
 * Higher levels pull the horizon in: 7.5 / 6.5 / 5.5 / 4.5 beats by quintile.
 * More reading pressure than BPM alone, and independent of it.
 */
export function visibleBeatsForLevel(level) {
  return Math.max(4, 7.5 - Math.floor((level - 1) / 5) * 1.0);
}

export class MiniGame {
  static id = 'base';
  static label = 'Base';

  /**
   * @param {Phaser.Scene} scene
   * @param {{x,y,width,height}} bounds  the middle panel rect
   * @param {Conductor} conductor
   * @param {object} opts { onJudged(judgment, note), onNoteSpawn(note), getTier() }
   */
  constructor(scene, bounds, conductor, opts = {}) {
    this.scene = scene;
    this.bounds = bounds;
    this.conductor = conductor;
    this.opts = opts;
    this.layer = scene.add.container(0, 0);
    this.notes = [];
    this.upcoming = [];     // next phrase, drawn for continuity but not judged
    this.phrase = null;
    this.active = false;

    this.speedTier = 1;
    /** Per-level sight distance (B5). Falls back to VISIBLE_BEATS. */
    this._visibleBeats = opts.visibleBeats ?? null;
    /**
     * Continuous multiplier on how long notes take to arrive, kept separate from
     * the integer speedTier. >1 means MORE approach time, i.e. easier.
     * Half Time and Tempo Thief use this; Hurry uses speedTier.
     */
    this.speedMultiplier = 1;
    /** Notes are invisible but still judged until this beat (enemy "Jam"). */
    this.jamUntilBeat = -1;
    /** Enemy "Mirror": lanes flip horizontally for the phrase. */
    this.mirrored = false;
  }

  create() {}

  /** Effective approach time in beats, after every speed modifier. */
  approachBeats(base) {
    const tierSpeed = 1 + (this.speedTier - 1) * 0.22;
    return (base / tierSpeed) * this.speedMultiplier;
  }

  get isJammed() { return this.conductor.beat < this.jamUntilBeat; }

  /**
   * How far ahead tiles are allowed to render, in beats.
   *
   * Jam used to hide notes completely, which is not a challenge — it is a
   * blindfold, and there is no skilful response to it. Cutting the sight line
   * down to JAM_REVEAL_BEATS keeps every note playable but strips away your
   * reading time, so good players can still cope and bad ones get punished.
   */
  get visibleBeats() {
    if (this.isJammed) return JAM_REVEAL_BEATS;
    return this._visibleBeats ?? VISIBLE_BEATS;
  }

  /**
   * Jam expressed as a RATIO rather than an absolute beat count.
   *
   * Minigames have different approach windows — Osu's (~2.4 beats) is shorter
   * than JAM_REVEAL_BEATS itself, so applying that number literally would make
   * Jam a no-op there. Scaling by the ratio keeps the debuff equally severe
   * whatever the window happens to be.
   */
  get jamVisibilityFactor() {
    return this.isJammed ? JAM_REVEAL_BEATS / VISIBLE_BEATS : 1;
  }

  /** Called when a new phrase starts. `phrase.notes` beats are phrase-relative. */
  startPhrase(phrase) {
    this.phrase = phrase;
    this.active = true;
    this.notes = phrase.notes.map((n) => ({
      ...n,
      lane: this.mirrored ? (LANES - 1 - n.lane) : n.lane,
      absBeat: phrase.startBeat + n.beat,
      hit: false,
      judged: false,
      obj: null,
    }));
  }

  endPhrase() {
    this.active = false;
    // Mirror and jam are per-phrase effects; they must not leak into the next one.
    this.mirrored = false;
    this.jamUntilBeat = -1;
  }

  onBeat() {}
  update() {}
  setSpeedTier(tier) { this.speedTier = tier; }

  /**
   * Tell the minigame where the next MODE CHANGE lands.
   *
   * @param {{beat:number, type:'enemy'|'hero'}|null} gate
   *
   * Phrases alternate defend/attack, and cutting between them with nothing but
   * a text banner is jarring — the player is mid-flow and the rules change
   * under them. A gate the ball physically crosses turns that cut into a
   * transition you can see coming and read at a glance from its colour.
   * Minigames that have no track (Osu) can ignore this.
   */
  setGate(gate) { this.gate = gate || null; }

  /**
   * Preview of the NEXT phrase, rendered but never judged.
   *
   * Without this the road simply ends at the mode gate, which makes the track
   * look like it stops and restarts every 16 beats. Showing what lies beyond
   * the gate keeps the road continuous and lets the player read the next
   * section's shape while still playing the current one.
   *
   * Preview notes are deliberately NOT mirrored: Mirror is rolled when the
   * phrase actually begins, so it is not known yet at preview time.
   */
  setUpcoming(phrase) {
    this.upcoming = phrase
      ? phrase.notes.map((n) => ({
        ...n,
        absBeat: phrase.startBeat + n.beat,
        phraseType: phrase.type,
        judged: false,
        preview: true,
        drawn: false,
      }))
      : [];
  }
  setSpeedMultiplier(m) { this.speedMultiplier = m; }
  setJam(untilBeat) { this.jamUntilBeat = untilBeat; }
  setMirror(on) { this.mirrored = !!on; }

  /** Report a judgment upward. Always route through here, never call combat directly. */
  emitJudgment(judgment, note) {
    this.opts.onJudged?.(judgment, note);
  }

  destroy() {
    this.layer?.destroy(true);
    this.notes = [];
  }
}

/** Registry — add new minigames here and they become selectable per level. */
export const MINIGAMES = {};

export function registerMiniGame(cls) { MINIGAMES[cls.id] = cls; }
export function getMiniGame(id) { return MINIGAMES[id] || MINIGAMES.ballhop; }
