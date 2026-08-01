/**
 * OsuCircles — levels 11-20. Move the mouse onto numbered circles as the
 * approach ring closes. There is no click input in this mode.
 *
 * Same chart data as BallHop, read differently: `lane` becomes a position on a
 * guided motion path instead of a column. That is the proof the abstraction works —
 * neither minigame knows the other exists, and combat knows neither.
 *
 * Harder than BallHop on purpose: you must aim AND time, and accuracy is judged
 * purely on the beat rather than being softened by position.
 */
import Phaser from 'phaser';
import { MiniGame, registerMiniGame } from './MiniGame.js';
import { judge, JUDGMENTS, missThreshold } from '../core/Judge.js';
import { LANES } from '../core/ChartGen.js';

// Keep the sight line short so fewer circles are visible at once. The tighter
// window makes each remaining target arrive faster without changing the shared
// chart or Ball Hop difficulty.
const APPROACH_BEATS = 2.0;
// Osu targets need to be easy to acquire with movement alone. Ball Hop keeps
// its own tile scale and is intentionally unaffected by this value.
const RADIUS = 44;

export class OsuCircles extends MiniGame {
  static id = 'osu';
  static label = 'Osu Circles';

  create() {
    const b = this.bounds;
    const s = this.scene;
    const g = s.add.graphics();

    // Same neon language as BallHop: dark field, glowing grid, bloomed edges.
    g.fillStyle(0x02030a, 1);
    g.fillRoundedRect(b.x, b.y, b.width, b.height, 12);
    g.fillStyle(0x06101c, 0.75);
    g.fillRoundedRect(b.x + 2, b.y + 2, b.width - 4, b.height - 4, 10);

    const step = b.width / 12;
    g.lineStyle(1, 0x1b6f8a, 0.16);
    for (let x = b.x + step; x < b.x + b.width; x += step) g.lineBetween(x, b.y + 6, x, b.y + b.height - 6);
    for (let y = b.y + step; y < b.y + b.height; y += step) g.lineBetween(b.x + 6, y, b.x + b.width - 6, y);

    for (const [w, a] of [[9, 0.08], [5, 0.18], [2, 0.55]]) {
      g.lineStyle(w, 0x3ad1ff, a);
      g.strokeRoundedRect(b.x + 1, b.y + 1, b.width - 2, b.height - 2, 12);
    }
    this.layer.add(g);
    this.frameGfx = g;

    // A single guide path makes the next jump readable before the circle
    // arrives. It sits behind the numbered targets and is redrawn each frame.
    this.pathGfx = s.add.graphics();
    this.layer.add(this.pathGfx);

    // Numbering is continuous for readability, but the guide itself is scoped
    // to one phrase so defense and attack never share a colored bridge.
    this.pathSequence = 0;
    this.pathStarted = false;

    this.hintText = s.add.text(b.x + b.width / 2, b.y + 14,
      'DRAG TO PLAY — move onto the numbered circle', {
      fontFamily: 'Trebuchet MS', fontSize: '13px', color: '#6a7a90',
    }).setOrigin(0.5, 0);
    this.layer.add(this.hintText);

    this.cursorHalo = s.add.circle(b.x + b.width / 2, b.y + b.height / 2, 16, 0xffffff, 0.10);
    this.cursor = s.add.circle(b.x + b.width / 2, b.y + b.height / 2, 6, 0xffffff, 0.75);
    this.layer.add([this.cursorHalo, this.cursor]);

    this.pointerX = b.x + b.width / 2;
    this.pointerY = b.y + b.height / 2;
    s.input.on('pointermove', this.onMove, this);
  }

  onMove(p) {
    this.pointerX = p.x;
    this.pointerY = p.y;
    this.cursor.setPosition(p.x, p.y);
    this.cursorHalo.setPosition(p.x, p.y);
  }

  /**
   * Guided position for a note. The lane controls the main horizontal jump;
   * the row weave is deterministic and bounded, so circles form a readable
   * left/right/up/down motion line instead of independent random scatter.
   */
  posFor(note, index, total) {
    const b = this.bounds;
    const padX = RADIUS + 34;
    const padY = RADIUS + 42;
    const usableW = b.width - padX * 2;
    const usableH = b.height - padY * 2;
    const laneT = LANES <= 1 ? 0.5 : note.lane / (LANES - 1);
    // Keep the path in a tighter central corridor. The old full-width scatter
    // made every jump span the whole panel, which looked random and forced
    // unnecessary cursor travel.
    const pathW = usableW * 0.44;
    const pathH = usableH * 0.54;
    const xBase = b.x + b.width / 2 + (laneT - 0.5) * pathW;
    // A fixed number of rows keeps the weave phase stable when a phrase has a
    // different note count. Variable row counts made the route visibly jump
    // at the defense/attack boundary.
    const rowCount = 7;
    const row = (index * 2 + Math.floor(index / 3)) % rowCount;
    const yBase = b.y + b.height / 2 - pathH / 2
      + (row / Math.max(1, rowCount - 1)) * pathH;

    // Small alternating offsets create visible jumps without making the
    // cursor chase an impossible target. The offsets are derived only from
    // sequence index, so they are deterministic and easy to practise.
    const xOffset = Math.sin(index * 1.17) * Math.min(18, usableW * 0.04);
    const yOffset = Math.cos(index * 0.83) * Math.min(14, usableH * 0.035);
    const x = Phaser.Math.Clamp(xBase + xOffset, b.x + padX, b.x + b.width - padX);
    const y = Phaser.Math.Clamp(yBase + yOffset, b.y + padY, b.y + b.height - padY);
    return { x, y };
  }

  startPhrase(phrase) {
    super.startPhrase(phrase);
    // A chart with index 0 is a new run. Reset only there so normal phrase
    // changes can keep their global numbering without linking their paths.
    if (phrase.index === 0 || !this.pathStarted) {
      this.pathSequence = 0;
    }
    const phraseOffset = this.pathSequence;
    const isEnemy = phrase.type === 'enemy';
    this.notes.forEach((n, i) => {
      const sequenceIndex = phraseOffset + i;
      const p = this.posFor(n, sequenceIndex, this.notes.length);
      n.x = p.x; n.y = p.y;
      n.sequence = sequenceIndex;
      n.color = isEnemy ? 0xff3b6b : 0x2bff88;

      // Layered halo behind each circle fakes a bloom, matching BallHop.
      const halo = this.scene.add.circle(p.x, p.y, RADIUS * 1.7, n.color, 0.10);
      halo.setVisible(false);
      this.layer.add(halo);

      const circle = this.scene.add.circle(p.x, p.y, RADIUS, n.color, 0.22);
      circle.setStrokeStyle(4, n.color, 1);
      circle.setVisible(false);
      this.layer.add(circle);

      const core = this.scene.add.circle(p.x, p.y, RADIUS * 0.34, 0xffffff, 0.75);
      core.setVisible(false);
      this.layer.add(core);

      const label = this.scene.add.text(p.x, p.y, String(sequenceIndex + 1), {
        fontFamily: 'Orbitron', fontSize: '21px', fontStyle: 'bold',
        color: '#ffffff', stroke: '#02030a', strokeThickness: 4,
      }).setOrigin(0.5).setText(String(sequenceIndex + 1)).setVisible(false);
      this.layer.add(label);

      const ring = this.scene.add.circle(p.x, p.y, RADIUS * 3, n.color, 0);
      ring.setStrokeStyle(3, 0xffffff, 0.8);
      ring.setVisible(false);
      this.layer.add(ring);

      n.obj = circle;
      n.halo = halo;
      n.core = core;
      n.label = label;
      n.ring = ring;
      this.opts.onNoteSpawn?.(n);
    });
    this.pathSequence += this.notes.length;
    this.pathStarted = true;
    this.layer.bringToTop(this.cursor);
  }

  setSpeedTier(tier) {
    this.speedTier = tier;
    this.hintText?.setText(
      tier > 1 ? `${['CHILL', 'NORMAL', 'HURRY', 'FRENZY'][tier]} — rings close faster`
               : 'DRAG TO PLAY — move onto the numbered circle');
  }

  /**
   * Draw the motion path between numbered circles in the active phrase.
   *
   * Standard Osu target groups do not carry a connector across a mode or
   * section boundary. Keeping this list phrase-local prevents a judged red
   * target from leaving a red line into the next green target.
   */
  drawMotionPath(beat, approach, color) {
    const g = this.pathGfx;
    g.clear();
    const upcoming = this.notes
      .filter((n) => !n.judged && n.shown && n.absBeat >= beat)
      .sort((a, b) => a.absBeat - b.absBeat);
    if (upcoming.length < 2) return;

    for (let i = 0; i < upcoming.length - 1; i++) {
      const a = upcoming[i], b = upcoming[i + 1];
      const beatsAhead = Math.max(0, (a.absBeat ?? beat) - beat);
      const fade = Phaser.Math.Clamp(1 - beatsAhead / (approach * 2.2), 0.12, 0.78);
      g.lineStyle(2.5, color, fade * 0.52);
      g.lineBetween(a.x, a.y, b.x, b.y);

      // Small arrow chevrons point toward the next target and make direction
      // changes obvious even when two circles are far apart.
      const dx = b.x - a.x, dy = b.y - a.y;
      const length = Math.hypot(dx, dy) || 1;
      const ux = dx / length, uy = dy / length;
      const px = -uy, py = ux;
      const mx = a.x + dx * 0.68, my = a.y + dy * 0.68;
      const size = 8;
      g.lineStyle(2, color, fade * 0.72);
      g.lineBetween(mx - ux * size + px * size, my - uy * size + py * size,
        mx, my);
      g.lineBetween(mx, my, mx - ux * size - px * size, my - uy * size - py * size);
    }
  }

  /** Mouse-over timing: being on the circle at the beat is the input. */
  tryMoveHit(note, beat, threshold) {
    const dx = this.pointerX - note.x, dy = this.pointerY - note.y;
    const underCursor = dx * dx + dy * dy <= (RADIUS * 1.35) ** 2;
    if (!underCursor) return false;
    const errMs = Math.abs((beat - note.absBeat) * this.conductor.msPerBeat);
    if (errMs > threshold) return false;
    this.resolve(note, judge(errMs, this.speedTier));
    return true;
  }

  update() {
    if (!this.conductor.isPlaying || !this.active) return;
    const beat = this.conductor.beat;
    const approach = this.approachBeats(APPROACH_BEATS);
    const threshold = missThreshold(this.speedTier);
    // Jam shortens the sight line rather than blindfolding you outright: the
    // circles still appear, just far later, so there is a skilful response.
    //
    // Osu's approach window (~2.0 beats) is SHORTER than JAM_REVEAL_BEATS, so
    // applying that figure literally would make Jam do nothing here. Scale by
    // the same ratio instead, which keeps the two minigames comparable.
    const limit = approach * this.jamVisibilityFactor;

    for (const n of this.notes) {
      if (!n.obj || n.judged) continue;
      const beatsAway = n.absBeat - beat;

      if (beatsAway > approach) continue;
      n.shown = true;
      const hidden = beatsAway > limit;
      n.obj.setVisible(!hidden);
      n.ring.setVisible(!hidden);
      n.halo?.setVisible(!hidden);
      n.core?.setVisible(!hidden);

      const t = Phaser.Math.Clamp(1 - beatsAway / approach, 0, 2);
      const a = hidden ? 0 : Math.min(1, t * 2);
      n.obj.setAlpha(a);
      n.halo?.setAlpha(a * 0.55);
      // The core brightens as the ring closes, so "now" is readable at a glance.
      n.core?.setAlpha(hidden ? 0 : a * Math.max(0, t) * 0.9);
      n.core?.setScale(0.7 + Math.max(0, t) * 0.5);
      n.label?.setVisible(!hidden).setPosition(n.x, n.y).setAlpha(hidden ? 0 : a);
      // Ring shrinks from 3x to 1x, landing exactly on the beat
      const r = RADIUS * (1 + 2 * Math.max(0, 1 - t));
      n.ring.setRadius(r);
      n.ring.setAlpha(hidden ? 0 : Math.min(0.9, t * 1.6));

      const errMs = (beat - n.absBeat) * this.conductor.msPerBeat;
      if (errMs >= -threshold && errMs <= threshold) this.tryMoveHit(n, beat, threshold);
      else if (errMs > threshold) this.resolve(n, JUDGMENTS.MISS);
    }

    const pathColor = this.notes.find((n) => !n.judged)?.color || 0x3ad1ff;
    this.drawMotionPath(beat, approach, pathColor);
  }

  resolve(note, judgment) {
    note.judged = true;
    note.ring?.destroy();
    note.core?.destroy();
    note.halo?.destroy();
    note.label?.destroy();
    if (note.obj) {
      note.obj.setStrokeStyle(3, judgment.color, 1);
      this.scene.tweens.add({
        targets: note.obj,
        scale: judgment.weight > 0 ? 1.7 : 0.6,
        alpha: 0, duration: 220,
        onComplete: () => note.obj?.destroy(),
      });
    }
    // Keep timing feedback attached to the target, like Osu's hit bursts. It
    // sits below the enlarged circle and stays small enough not to cover the
    // next target or the player's route.
    const feedback = this.scene.add.text(note.x, note.y + RADIUS + 10, judgment.name, {
      fontFamily: 'Orbitron', fontSize: '11px', fontStyle: 'bold',
      color: '#ffffff', stroke: '#02030a', strokeThickness: 3,
    }).setOrigin(0.5, 0).setTint(judgment.color);
    this.layer.add(feedback);
    this.scene.tweens.add({
      targets: feedback, y: note.y + RADIUS + 26, alpha: 0, duration: 420,
      onComplete: () => feedback.destroy(),
    });
    this.emitJudgment(judgment, note);
  }

  endPhrase() {
    super.endPhrase();
    for (const n of this.notes) {
      if (!n.judged) { n.judged = true; this.emitJudgment(JUDGMENTS.MISS, n); }
      n.obj?.destroy(); n.ring?.destroy(); n.core?.destroy(); n.halo?.destroy();
      n.label?.destroy();
    }
    this.pathGfx?.clear();
    this.notes = [];
  }

  destroy() {
    this.scene.input.off('pointermove', this.onMove, this);
    super.destroy();
  }
}

registerMiniGame(OsuCircles);
