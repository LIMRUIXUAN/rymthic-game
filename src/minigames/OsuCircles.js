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
const SLIDER_TICKS = 4;
// Slider travel is deliberately gentler than the circle cadence. At 120 BPM
// the old 0.42-beat duration was only about 210 ms, which made the follow ball
// feel like a flick instead of a readable movement.
const SLIDER_DURATION_SCALE = 0.68;
const SLIDER_MIN_DURATION = 0.38;
const SLIDER_MAX_DURATION = 0.82;
const SLIDER_HEAD_RADIUS = RADIUS * 1.5;
const SLIDER_TICK_RADIUS = RADIUS * 1.12;
const SLIDER_BALL_RADIUS = RADIUS * 0.36;
const FLASHLIGHT_RADIUS = 150;
const SPINNER_TURNS = 2.5;

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
    this.level = Number(this.opts.level ?? 11);
    this.hiddenUntilBeat = -1;
    this.flashlightUntilBeat = -1;
    this.spinnerState = null;
    this.nextTarget = null;

    this.hintText = s.add.text(b.x + b.width / 2, b.y + 14,
      'DRAG TO PLAY — move onto the numbered circle', {
      fontFamily: 'Trebuchet MS', fontSize: '13px', color: '#6a7a90',
    }).setOrigin(0.5, 0);
    this.layer.add(this.hintText);

    this.cursorHalo = s.add.circle(b.x + b.width / 2, b.y + b.height / 2, 16, 0xffffff, 0.10);
    this.cursor = s.add.circle(b.x + b.width / 2, b.y + b.height / 2, 6, 0xffffff, 0.75);
    this.layer.add([this.cursorHalo, this.cursor]);

    // Flashlight is intentionally a quiet ring rather than a full-screen
    // overlay. Targets outside it are hidden in update(), while the ring tells
    // the player exactly how much of the playfield is currently readable.
    this.flashlightGfx = s.add.graphics();
    this.layer.add(this.flashlightGfx);
    this.spinnerGfx = s.add.graphics();
    this.layer.add(this.spinnerGfx);
    this.spinnerText = s.add.text(b.x + b.width / 2, b.y + b.height - 42, '', {
      fontFamily: 'Orbitron', fontSize: '12px', fontStyle: 'bold', color: '#ffd166',
    }).setOrigin(0.5).setVisible(false);
    this.layer.add(this.spinnerText);

    this.pointerX = b.x + b.width / 2;
    this.pointerY = b.y + b.height / 2;
    s.input.on('pointermove', this.onMove, this);
  }

  onMove(p) {
    if (this.spinnerState) {
      const angle = Math.atan2(p.y - this.spinnerState.y, p.x - this.spinnerState.x);
      if (Number.isFinite(this.spinnerState.lastAngle)) {
        let delta = angle - this.spinnerState.lastAngle;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        this.spinnerState.spin += Math.abs(delta);
      }
      this.spinnerState.lastAngle = angle;
    }
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

  setHidden(untilBeat) {
    this.hiddenUntilBeat = Number(untilBeat) || -1;
  }

  setFlashlight(untilBeat) {
    this.flashlightUntilBeat = Number(untilBeat) || -1;
  }

  get isHidden() {
    return this.conductor.beat < this.hiddenUntilBeat;
  }

  get isFlashlight() {
    return this.conductor.beat < this.flashlightUntilBeat;
  }

  /** Deterministic special-object cadence, sparse enough to read musically. */
  objectTypeFor(sequenceIndex) {
    if (this.level < 11) return 'circle';
    if (sequenceIndex % 13 === 7) return 'spinner';
    if (sequenceIndex % 6 === 2) return 'slider';
    return 'circle';
  }

  configureSlider(note, index) {
    const next = this.notes[index + 1];
    const gap = next ? Math.max(0.5, next.absBeat - note.absBeat) : 1.5;
    const end = next ? { x: next.x, y: next.y } : {
      x: Phaser.Math.Clamp(note.x + (index % 2 ? -90 : 90), this.bounds.x + RADIUS,
        this.bounds.x + this.bounds.width - RADIUS),
      y: Phaser.Math.Clamp(note.y + (index % 2 ? 55 : -55), this.bounds.y + RADIUS,
        this.bounds.y + this.bounds.height - RADIUS),
    };
    const dx = end.x - note.x, dy = end.y - note.y;
    const length = Math.hypot(dx, dy) || 1;
    const bend = (index % 2 ? -1 : 1) * Math.min(72, length * 0.34);
    const mid = { x: (note.x + end.x) / 2 - (dy / length) * bend,
      y: (note.y + end.y) / 2 + (dx / length) * bend };
    note.objectType = 'slider';
    note.reverseSlider = note.sequence % 12 === 8;
    note.sliderPath = [{ x: note.x, y: note.y }, mid, end];
    note.sliderBaseDuration = Phaser.Math.Clamp(gap * SLIDER_DURATION_SCALE,
      SLIDER_MIN_DURATION, SLIDER_MAX_DURATION);
    note.sliderRepeats = note.reverseSlider ? 2 : 1;
    note.sliderEndBeat = note.absBeat + note.sliderBaseDuration * note.sliderRepeats;
    note.sliderTicks = Array.from({ length: SLIDER_TICKS * note.sliderRepeats }, (_, i) => ({
      beat: note.absBeat + note.sliderBaseDuration * ((i + 1) / SLIDER_TICKS),
      hit: false,
      checked: false,
    }));
    note.sliderStarted = false;
    note.sliderHeadHit = false;
    note.sliderGfx = this.scene.add.graphics();
    note.sliderBall = this.scene.add.circle(note.x, note.y, SLIDER_BALL_RADIUS, 0xffffff, 0.9);
    note.sliderBall.setVisible(false);
    this.layer.add(note.sliderGfx);
    this.layer.add(note.sliderBall);
  }

  configureSpinner(note) {
    note.objectType = 'spinner';
    note.spinnerDuration = 0.72;
    note.spinnerEndBeat = note.absBeat + note.spinnerDuration;
    note.spinnerRequiredSpin = Math.PI * 2 * SPINNER_TURNS;
    note.spinnerStarted = false;
    note.spinnerProgress = 0;
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
      n.objectType = this.objectTypeFor(sequenceIndex);
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

      const targetGlow = this.scene.add.circle(p.x, p.y, RADIUS * 1.18, n.color, 0);
      targetGlow.setStrokeStyle(2.5, 0xffffff, 0.9);
      targetGlow.setVisible(false);
      this.layer.add(targetGlow);

      n.obj = circle;
      n.halo = halo;
      n.core = core;
      n.label = label;
      n.ring = ring;
      n.targetGlow = targetGlow;
      this.opts.onNoteSpawn?.(n);
    });
    // Positions are known for the whole phrase now, so sliders can safely use
    // the next target as their tail without mutating the shared chart.
    this.notes.forEach((n, i) => {
      if (n.objectType === 'slider') this.configureSlider(n, i);
      else if (n.objectType === 'spinner') this.configureSpinner(n);
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
      .filter((n) => !n.judged && n.shown && n.visibleNow && n.absBeat >= beat)
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

  cursorNear(x, y, radius) {
    const dx = this.pointerX - x, dy = this.pointerY - y;
    return dx * dx + dy * dy <= radius * radius;
  }

  pathAt(note, progress) {
    const t = Phaser.Math.Clamp(progress, 0, 1);
    const [a, c, b] = note.sliderPath;
    const u = 1 - t;
    return {
      x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
    };
  }

  sliderPathProgress(note, beat) {
    const elapsed = Math.max(0, beat - note.absBeat);
    const phase = Math.min(note.sliderRepeats, elapsed / note.sliderBaseDuration);
    if (phase >= note.sliderRepeats) return note.sliderRepeats % 2 ? 0 : 1;
    const cycle = Math.floor(phase);
    const local = phase - cycle;
    return cycle % 2 ? 1 - local : local;
  }

  drawSlider(note, beat, visible) {
    const g = note.sliderGfx;
    g.clear();
    note.sliderBall?.setVisible(!!visible && note.sliderStarted);
    if (!visible) return;

    const [a, c, b] = note.sliderPath;
    g.lineStyle(11, note.color, 0.12);
    g.lineBetween(a.x, a.y, c.x, c.y);
    g.lineBetween(c.x, c.y, b.x, b.y);
    g.lineStyle(3, note.color, 0.72);
    g.lineBetween(a.x, a.y, c.x, c.y);
    g.lineBetween(c.x, c.y, b.x, b.y);
    for (const tick of note.sliderTicks) {
      const p = this.pathAt(note, this.sliderPathProgress(note, tick.beat));
      g.lineStyle(2, tick.checked && tick.hit ? 0xffffff : note.color,
        tick.checked && tick.hit ? 0.9 : 0.52);
      g.strokeCircle(p.x, p.y, 5);
    }
    if (note.reverseSlider) {
      const p = this.pathAt(note, 1);
      g.lineStyle(2.5, 0xffffff, 0.85);
      g.lineBetween(p.x - 8, p.y - 7, p.x + 1, p.y);
      g.lineBetween(p.x + 1, p.y, p.x - 8, p.y + 7);
    }
    if (note.sliderStarted) {
      const p = this.pathAt(note, this.sliderPathProgress(note, beat));
      note.sliderBall?.setPosition(p.x, p.y).setFillStyle(note.color, 0.95);
    }
  }

  applyNoteVisibility(note, beat, approach) {
    const beatsAway = note.absBeat - beat;
    const jamHidden = beatsAway > approach * this.jamVisibilityFactor;
    const hiddenMode = this.isHidden && beatsAway > 0.72;
    const flashlightHidden = this.isFlashlight && !this.cursorNear(note.x, note.y, FLASHLIGHT_RADIUS);
    const hidden = jamHidden || hiddenMode || flashlightHidden;
    const t = Phaser.Math.Clamp(1 - beatsAway / approach, 0, 2);
    const alpha = hidden ? 0 : Math.min(1, t * 2);
    const showRing = !hidden && !this.isHidden;
    note.visibleNow = !hidden;
    note.shown = true;
    note.obj.setVisible(!hidden);
    note.ring.setVisible(showRing);
    note.halo?.setVisible(!hidden);
    note.core?.setVisible(!hidden);
    note.label?.setVisible(!hidden).setPosition(note.x, note.y).setAlpha(alpha);
    note.obj.setAlpha(alpha);
    note.halo?.setAlpha(alpha * 0.55);
    note.core?.setAlpha(hidden ? 0 : alpha * Math.max(0, t) * 0.9);
    note.core?.setScale(0.7 + Math.max(0, t) * 0.5);
    const r = RADIUS * (1 + 2 * Math.max(0, 1 - t));
    note.ring.setRadius(r);
    note.ring.setAlpha(showRing ? Math.min(0.9, t * 1.6) : 0);
    return { beatsAway, hidden, alpha };
  }

  updateSlider(note, beat, approach, threshold) {
    const { beatsAway, hidden } = this.applyNoteVisibility(note, beat, approach);
    const visible = !hidden;
    this.drawSlider(note, beat, visible);
    if (beatsAway > approach) return;

    if (!note.sliderStarted) {
      const headWindow = threshold / this.conductor.msPerBeat;
      if (beat >= note.absBeat - headWindow && beat <= note.absBeat + headWindow) {
        if (this.cursorNear(note.x, note.y, SLIDER_HEAD_RADIUS)) {
          note.sliderStarted = true;
          note.sliderHeadHit = true;
        }
      }
      if (beat > note.absBeat + headWindow) {
        this.resolve(note, JUDGMENTS.MISS);
      }
      return;
    }

    for (const tick of note.sliderTicks) {
      if (tick.checked || beat < tick.beat) continue;
      tick.checked = true;
      const p = this.pathAt(note, this.sliderPathProgress(note, tick.beat));
      tick.hit = this.cursorNear(p.x, p.y, SLIDER_TICK_RADIUS);
    }
    if (beat < note.sliderEndBeat) return;

    const hits = note.sliderTicks.filter((tick) => tick.hit).length;
    const ratio = hits / Math.max(1, note.sliderTicks.length);
    const result = ratio >= 0.88 ? JUDGMENTS.PERFECT
      : ratio >= 0.62 ? JUDGMENTS.GREAT
        : ratio >= 0.30 ? JUDGMENTS.GOOD : JUDGMENTS.MISS;
    this.resolve(note, result);
  }

  drawSpinnerMeter(progress, active) {
    const g = this.spinnerGfx;
    g.clear();
    this.spinnerText?.setVisible(!!active);
    if (!active) return;
    const b = this.bounds;
    const w = Math.min(300, b.width * 0.68);
    const h = 10;
    const x = b.x + b.width / 2 - w / 2;
    const y = b.y + b.height - 54;
    g.fillStyle(0x080812, 0.92);
    g.fillRoundedRect(x, y, w, h, 5);
    g.lineStyle(1.5, 0xffd166, 0.72);
    g.strokeRoundedRect(x, y, w, h, 5);
    g.fillStyle(0xffd166, 0.90);
    g.fillRoundedRect(x + 2, y + 2, (w - 4) * progress, h - 4, 3);
    this.spinnerText?.setPosition(b.x + b.width / 2, y - 14)
      .setText(`SPINNER  ${Math.round(progress * 100)}%`)
      .setColor('#ffd166');
  }

  updateSpinner(note, beat, approach, threshold) {
    const { beatsAway, hidden } = this.applyNoteVisibility(note, beat, approach);
    note.obj.setScale(1.2);
    note.ring.setScale(1.05);
    if (beatsAway > approach) return;

    const headWindow = threshold / this.conductor.msPerBeat;
    if (!note.spinnerStarted && beat >= note.absBeat - headWindow
      && beat <= note.absBeat + headWindow
      && this.cursorNear(note.x, note.y, RADIUS * 2.1)) {
      note.spinnerStarted = true;
      this.spinnerState = {
        note, x: note.x, y: note.y, spin: 0,
        lastAngle: Math.atan2(this.pointerY - note.y, this.pointerX - note.x),
      };
    }

    if (!note.spinnerStarted) {
      if (beat > note.absBeat + headWindow) this.resolve(note, JUDGMENTS.MISS);
      return;
    }

    note.spinnerProgress = Phaser.Math.Clamp(
      this.spinnerState.spin / note.spinnerRequiredSpin, 0, 1);
    this.drawSpinnerMeter(note.spinnerProgress, true);
    if (beat < note.spinnerEndBeat) return;
    const progress = note.spinnerProgress;
    const result = progress >= 0.95 ? JUDGMENTS.PERFECT
      : progress >= 0.70 ? JUDGMENTS.GREAT
        : progress >= 0.40 ? JUDGMENTS.GOOD : JUDGMENTS.MISS;
    this.spinnerState = null;
    this.drawSpinnerMeter(0, false);
    this.resolve(note, result);
  }

  updateNextTarget(beat) {
    const next = this.notes.find((n) => !n.judged && n.shown && n.visibleNow);
    this.nextTarget = next || null;
    const pulse = 0.58 + Math.sin(performance.now() * 0.009) * 0.22;
    for (const n of this.notes) {
      const active = n === this.nextTarget;
      n.targetGlow?.setVisible(active).setPosition(n.x, n.y).setAlpha(active ? pulse : 0);
    }
  }

  drawFlashlight() {
    const g = this.flashlightGfx;
    g.clear();
    if (!this.isFlashlight) return;
    g.lineStyle(3, 0xffffff, 0.46);
    g.strokeCircle(this.pointerX, this.pointerY, FLASHLIGHT_RADIUS);
    g.lineStyle(1, 0x5ef2ff, 0.24);
    g.strokeCircle(this.pointerX, this.pointerY, FLASHLIGHT_RADIUS * 0.86);
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
    for (const n of this.notes) {
      if (!n.obj || n.judged) continue;
      const beatsAway = n.absBeat - beat;

      if (beatsAway > approach) continue;

      if (n.objectType === 'slider') {
        this.updateSlider(n, beat, approach, threshold);
        continue;
      }
      if (n.objectType === 'spinner') {
        this.updateSpinner(n, beat, approach, threshold);
        continue;
      }

      const { hidden } = this.applyNoteVisibility(n, beat, approach);

      const errMs = (beat - n.absBeat) * this.conductor.msPerBeat;
      if (errMs >= -threshold && errMs <= threshold) this.tryMoveHit(n, beat, threshold);
      else if (errMs > threshold) this.resolve(n, JUDGMENTS.MISS);
    }

    const pathColor = this.notes.find((n) => !n.judged)?.color || 0x3ad1ff;
    this.drawMotionPath(beat, approach, pathColor);
    this.updateNextTarget(beat);
    this.drawFlashlight();
  }

  resolve(note, judgment) {
    note.judged = true;
    note.ring?.destroy();
    note.core?.destroy();
    note.halo?.destroy();
    note.label?.destroy();
    note.targetGlow?.destroy();
    note.sliderGfx?.clear();
    note.sliderGfx?.destroy();
    note.sliderBall?.destroy();
    if (this.spinnerState?.note === note) {
      this.spinnerState = null;
      this.drawSpinnerMeter(0, false);
    }
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
    this.spinnerState = null;
    this.hiddenUntilBeat = -1;
    this.flashlightUntilBeat = -1;
    this.drawSpinnerMeter(0, false);
    this.flashlightGfx?.clear();
    for (const n of this.notes) {
      if (!n.judged) { n.judged = true; this.emitJudgment(JUDGMENTS.MISS, n); }
      n.obj?.destroy(); n.ring?.destroy(); n.core?.destroy(); n.halo?.destroy();
      n.label?.destroy(); n.targetGlow?.destroy(); n.sliderGfx?.destroy(); n.sliderBall?.destroy();
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
