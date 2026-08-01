import Phaser from 'phaser';
import { MiniGame, registerMiniGame, VISIBLE_BEATS } from './MiniGame.js';
import { judge, JUDGMENTS, missThreshold } from '../core/Judge.js';
import { LANES, TILE_KINDS } from '../core/ChartGen.js';
import { music } from '../core/MusicEngine.js';
import { HORIZON_Y_RATIO, BALL_Y_RATIO } from '../core/Layout.js';

/**
 * BallHop — levels 1-10. Mouse MOVEMENT only. Never a click.
 *
 * A neon road runs to a vanishing point. Tiles are 3D slabs rushing toward the
 * camera; you steer the ball left/right so it lands on them. The ball hops on a
 * fixed rhythm, so the only thing you control is which lane you are in when the
 * beat lands.
 *
 * PERSPECTIVE MODEL
 * Everything derives from one depth value `p`:
 *     p = 0  -> the ball's plane, nearest the camera
 *     p = 1  -> the far edge of the approach window
 * and one projection:
 *     s = 1 / (1 + p * DEPTH)      scale: 1 near -> 0 at the horizon
 *     y = horizonY + (ballY - horizonY) * s
 *     x = cx + laneOffset * s
 * Because x, y and size all scale by the same `s`, lanes converge correctly and
 * tiles draw as trapezoids with a front face — a slab, not a flat rectangle.
 *
 * VISUAL APPROACH
 * There are no image assets. Everything is vector primitives plus a fake bloom:
 * each glowing shape is stroked several times, widest and faintest first. That
 * is what turns "coloured blocks" into "neon".
 */

const DEPTH = 7.0;             // perspective strength; higher = steeper road
const APPROACH_BEATS = 4.0;    // how many beats of road are visible
const TILE_HALF_DEPTH = 0.05;
const TILE_HEIGHT = 26;        // slab thickness in px at p = 0
const HOP_HEIGHT = 46;

/** How far off a tile's centre still counts, in lane units. TILE_W derives from this. */
const HIT_TOLERANCE = 0.5;
/** Ball steering responsiveness. Higher = snappier, less lag behind the cursor. */
const STEER_LERP = 0.5;

// GAME_PLAN B4: dash. Flicking the mouse fast enough puts the ball into a short
// burst of extra steering with a neon trail — the reachability valve that lets
// denser charts stay fair, and a skill of its own (osu!catch's dash).
const DASH_VX = 1200;              // pointer speed (px/s) that triggers a dash
const DASH_MS = 260;               // dash duration
const DASH_STEER = 2.2;            // steering multiplier while dashing
const DASH_GHOSTS = 6;             // trail length
const HYPER_BEATS = 2.5;           // how close a tile must be to warn
const HYPER_LANES_PER_BEAT = 1.1;  // baseline reachable lanes per beat
const HYPER_DASH_LANES_PER_BEAT = 2.2; // reachable lanes per beat while dashing
/**
 * The ball's closest approach over this window before the beat is what counts.
 * Being in position early is good play and must not be punished.
 */
const SAMPLE_MS = 70;

const EQ_BARS = 26;            // spectrum bars down each side of the road
const CRUSH_START = 20;        // sustained hits before the rush state begins
const CRUSH_MAX_SPEED = 1.55;  // cap so the late streak stays readable
const CRUSH_MAGENTA = 0xff2fd6;
const CRUSH_CYAN = 0x5ef2ff;
const RUSH_DEPTH_PULL = 0.18;
const RUSH_HORIZON_LIFT = 18;
const RUSH_BALL_PUSH = 10;

// Special platform presentation and interaction. These are intentionally
// procedural, so the game keeps its no-asset neon style and avoids another
// flat rectangle appearing beside the real landing tile.
const TRAP_KEY = 0xd71968;
const TRAP_GLOW = 0xff6b9f;
const BOOST_KEY = 0xf09a32;
const BOOST_GLOW = 0xffe29a;
const BOOST_LENS = 0xffd166;
const BOOST_DURATION_MS = 7000;
const BOOST_SPEED = 1.30;
const LENS_PICKUP_TTL_MS = 900;
const TRAP_ESCAPE_MS = 1700;
const TRAP_ESCAPE_STEPS = 6;
const TRAP_GESTURE_MIN_PX = 18;

// From level 5 onward the runway gets a deliberately laggy camera drift. Each
// target holds for two complete phrases so the player can read the motion
// instead of getting a random shake every few seconds.
const DRIFT_MIN_LEVEL = 5;
const DRIFT_PHRASES = 2;
const DRIFT_LAG = 0.075;
const DRIFT_TARGETS = [
  { name: 'LEFT',  x: -54, y: 0,  angle: -0.052 },
  { name: 'RIGHT', x:  54, y: 0,  angle:  0.052 },
  { name: 'UP',    x: 0,  y: -34, angle:  0 },
  { name: 'RIGHT', x:  46, y: -18, angle:  0.038 },
  { name: 'LEFT',  x: -46, y: -18, angle: -0.038 },
];

const THEMES = {
  hero:  { key: 0x2bff88, glow: 0x9dffc6, rail: 0x2bff88, sky: 0x04140c, sun: 0x7dffb4 },
  enemy: { key: 0xff3b6b, glow: 0xffa8c0, rail: 0xff3b6b, sky: 0x180410, sun: 0xff9ab4 },
};

export class BallHop extends MiniGame {
  static id = 'ballhop';
  static label = 'Ball Hop';

  create() {
    const b = this.bounds;
    const s = this.scene;

    this.cx = b.x + b.width / 2;
    // DESIGN.md §2: full-screen stage — horizon high, ball low, road wide.
    this.horizonY = b.y + b.height * HORIZON_Y_RATIO;
    this.ballY = b.y + b.height * BALL_Y_RATIO;
    // Derive lane spacing from the lane COUNT so the road always fills the same
    // fraction of the panel. Hard-coding this meant a 3-lane track rendered as a
    // narrow ribbon down the middle with dead space either side.
    const ROAD_WIDTH_FRACTION = 0.74;
    const roadLaneUnits = (LANES - 1) + 1.24;   // lanes plus both shoulders
    this.laneGap = (b.width * ROAD_WIDTH_FRACTION) / roadLaneUnits;
    // Tile width is DERIVED from the hit tolerance so the visual and the hitbox
    // can never drift apart and lie to the player.
    this.tileW = this.laneGap * HIT_TOLERANCE * 2 * 0.97;

    this.ballX = this.cx;
    this.targetX = this.cx;
    this.theme = THEMES.hero;
    this.combo = 0;
    this.crushActive = false;
    this.crushSpeed = 1;
    this.crushLevel = 0;
    this.crushPulse = 0;
    this.boostUntilBeat = -1;
    this.boostPulse = 0;
    this.trapState = null;
    this.lensPickups = [];

    this.level = Number(this.opts.level ?? 1);
    this.viewDriftEnabled = this.level >= DRIFT_MIN_LEVEL;
    this.viewPivotX = this.cx;
    this.viewPivotY = this.horizonY + (this.ballY - this.horizonY) * 0.72;
    this.viewOffsetX = 0;
    this.viewOffsetY = 0;
    this.viewAngle = 0;
    this.viewTargetX = 0;
    this.viewTargetY = 0;
    this.viewTargetAngle = 0;
    this.viewDriftPhrase = 0;
    this.viewDriftSegment = -1;
    this.viewDriftDirection = 'CENTER';

    // Layers, back to front.
    this.bgGfx = s.add.graphics();     // redrawn only when the theme changes
    this.eqGfx = s.add.graphics();     // per frame
    this.roadGfx = s.add.graphics();   // per frame
    this.crushGfx = s.add.graphics();  // streak speed-lines and pulse ring
    this.tileGfx = s.add.graphics();   // per frame
    this.pickupGfx = s.add.graphics(); // lens-shaped rewards from Boost landings
    this.trapMeterGfx = s.add.graphics(); // untransformed escape meter
    this.layer.add([
      this.bgGfx, this.eqGfx, this.roadGfx, this.crushGfx,
      this.tileGfx, this.pickupGfx, this.trapMeterGfx,
    ]);

    this.drawBackdrop();

    // --- the ball: layered halos fake a bloom ---
    this.ballHalo2 = s.add.circle(this.ballX, this.ballY, 42, 0xffffff, 0.07);
    this.ballHalo1 = s.add.circle(this.ballX, this.ballY, 28, 0xffffff, 0.16);
    this.ballShadow = s.add.ellipse(this.ballX, this.ballY + 6, 40, 13, 0x000000, 0.5);
    this.ball = s.add.circle(this.ballX, this.ballY, 17, 0xffffff);
    this.ball.setStrokeStyle(3, 0xffffff, 0.95);

    // Dash trail pool — ghost circles that trail a dashing ball.
    this.dashUntil = 0;
    this._lastPtrX = 0;
    this._lastPtrT = undefined;
    this.ghosts = [];
    this.ghostPositions = [];
    for (let i = 0; i < DASH_GHOSTS; i++) {
      const gh = s.add.circle(this.ballX, this.ballY, 15, 0xffffff, 0);
      gh.setVisible(false);
      this.ghosts.push(gh);
      this.ghostPositions.push({ x: this.ballX, y: this.ballY });
    }
    this.layer.add([...this.ghosts, this.ballShadow, this.ballHalo2, this.ballHalo1, this.ball]);

    this.hintText = s.add.text(this.cx, b.y + b.height - 24,
      'DRAG TO PLAY — move the mouse, never click', {
      fontFamily: 'Trebuchet MS', fontSize: '13px', color: '#6a7a90',
    }).setOrigin(0.5, 0);
    this.layer.add(this.hintText);

    this.gateLabel = s.add.text(this.cx, 0, '', {
      fontFamily: 'Trebuchet MS', fontSize: '26px', fontStyle: 'bold',
    }).setOrigin(0.5).setAlpha(0);
    this.layer.add(this.gateLabel);

    // Keep only the compact multiplier; the mode name is already communicated
    // by the road colour and speed effects.
    this.crushText = s.add.text(this.cx, b.y + b.height * 0.17, '', {
      fontFamily: 'Orbitron', fontSize: '32px', fontStyle: 'bold',
      color: '#ff2fd6', stroke: '#02030a', strokeThickness: 5,
    }).setOrigin(0.5).setAlpha(0);
    this.layer.add(this.crushText);

    this.trapMeterText = s.add.text(this.cx, b.y + b.height - 70, '', {
      fontFamily: 'Orbitron', fontSize: '12px', fontStyle: 'bold',
      color: '#5ef2ff', stroke: '#02030a', strokeThickness: 3,
    }).setOrigin(0.5).setAlpha(0);
    this.layer.add(this.trapMeterText);

    this.scene.input.on('pointermove', this.onPointerMove, this);
  }

  // ------------------------------------------------------------- projection

  get rushPerspective() {
    return this.crushActive ? this.crushIntensity : 0;
  }

  get rushPitch() {
    return this.rushPerspective * RUSH_BALL_PUSH;
  }

  scaleAt(p) {
    // Pull the depth toward the camera during the streak. Far tiles grow
    // slightly sooner, which reads as a forward racing push rather than a flat
    // colour swap, while lane hitboxes remain in the original coordinate space.
    const depth = DEPTH * (1 - this.rushPerspective * RUSH_DEPTH_PULL);
    return 1 / (1 + Math.max(0, p) * depth);
  }

  yAt(p) {
    const horizon = this.horizonY - this.rushPerspective * RUSH_HORIZON_LIFT;
    const ball = this.ballY + this.rushPitch;
    return horizon + (ball - horizon) * this.scaleAt(p);
  }
  xAt(lane, p) {
    return this.cx + (lane - (LANES - 1) / 2) * this.laneGap * this.scaleAt(p);
  }
  laneAtX(x) { return (x - this.cx) / this.laneGap + (LANES - 1) / 2; }

  /** Map a logical playfield point through the slow runway camera drift. */
  viewPoint(x, y) {
    const dx = x - this.viewPivotX;
    const dy = y - this.viewPivotY;
    const c = Math.cos(this.viewAngle);
    const s = Math.sin(this.viewAngle);
    return {
      x: this.viewPivotX + this.viewOffsetX + c * dx - s * dy,
      y: this.viewPivotY + this.viewOffsetY + s * dx + c * dy,
    };
  }

  /** Convert a screen pointer back into the un-drifted lane coordinate system. */
  inverseViewPoint(x, y) {
    const dx = x - this.viewPivotX - this.viewOffsetX;
    const dy = y - this.viewPivotY - this.viewOffsetY;
    const c = Math.cos(this.viewAngle);
    const s = Math.sin(this.viewAngle);
    return {
      x: this.viewPivotX + c * dx + s * dy,
      y: this.viewPivotY - s * dx + c * dy,
    };
  }

  /** Apply the same transform to every drawn road/tile layer. */
  applyViewTransform() {
    const c = Math.cos(this.viewAngle);
    const s = Math.sin(this.viewAngle);
    const tx = this.viewPivotX + this.viewOffsetX - c * this.viewPivotX + s * this.viewPivotY;
    const ty = this.viewPivotY + this.viewOffsetY - s * this.viewPivotX - c * this.viewPivotY;
    for (const g of [this.eqGfx, this.roadGfx, this.crushGfx, this.tileGfx, this.pickupGfx]) {
      g?.setPosition(tx, ty).setRotation(this.viewAngle);
    }
  }

  /** Ease toward the current two-phrase drift target, creating the requested lag. */
  advanceViewDrift() {
    if (!this.viewDriftEnabled) {
      this.viewOffsetX = 0;
      this.viewOffsetY = 0;
      this.viewAngle = 0;
      return;
    }
    this.viewOffsetX += (this.viewTargetX - this.viewOffsetX) * DRIFT_LAG;
    this.viewOffsetY += (this.viewTargetY - this.viewOffsetY) * DRIFT_LAG;
    this.viewAngle += (this.viewTargetAngle - this.viewAngle) * DRIFT_LAG;
  }

  /** Select a new direction only after the previous direction held two phrases. */
  beginViewDrift() {
    if (!this.viewDriftEnabled) return;
    this.viewDriftPhrase += 1;
    const segment = Math.floor((this.viewDriftPhrase - 1) / DRIFT_PHRASES);
    if (segment === this.viewDriftSegment) return;
    const target = DRIFT_TARGETS[segment % DRIFT_TARGETS.length];
    this.viewDriftSegment = segment;
    this.viewDriftDirection = target.name;
    this.viewTargetX = target.x;
    this.viewTargetY = target.y;
    this.viewTargetAngle = target.angle;
  }

  // ------------------------------------------------------------- glow helpers

  /** Stroke a line several times — widest/faintest first — to fake bloom. */
  glowLine(g, x1, y1, x2, y2, color, width, alpha) {
    g.lineStyle(width * 4.5, color, alpha * 0.10);
    g.lineBetween(x1, y1, x2, y2);
    g.lineStyle(width * 2.2, color, alpha * 0.26);
    g.lineBetween(x1, y1, x2, y2);
    g.lineStyle(width, color, alpha);
    g.lineBetween(x1, y1, x2, y2);
  }

  /** Fill a polygon and give it a glowing rim. `pts` is a flat [x,y,...] list. */
  glowPoly(g, pts, fill, fillAlpha, rim, rimAlpha, rimWidth = 3) {
    const path = () => {
      g.beginPath();
      g.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
      g.closePath();
    };
    if (fillAlpha > 0) { g.fillStyle(fill, fillAlpha); path(); g.fillPath(); }
    if (rimAlpha > 0) {
      g.lineStyle(rimWidth * 3.2, rim, rimAlpha * 0.13); path(); g.strokePath();
      g.lineStyle(rimWidth * 1.7, rim, rimAlpha * 0.30); path(); g.strokePath();
      g.lineStyle(rimWidth, rim, rimAlpha); path(); g.strokePath();
    }
  }

  // ------------------------------------------------------------- backdrop

  setTheme(theme) {
    if (this.theme === theme) return;
    this.theme = theme;
    this.drawBackdrop();
  }

  /** Sky, portal sun, wireframe mountains, ground and floor grid. */
  drawBackdrop() {
    const b = this.bounds;
    const g = this.bgGfx;
    const t = this.theme;
    g.clear();

    g.fillStyle(0x02030a, 1);
    g.fillRoundedRect(b.x, b.y, b.width, b.height, 12);
    g.fillStyle(t.sky, 0.9);
    g.fillRect(b.x + 2, b.y + 2, b.width - 4, this.horizonY - b.y);

    // --- portal sun: bright dome with scan bands and a dashed outer ring ---
    const R = Math.min(b.width * 0.20, (this.horizonY - b.y) * 0.82);
    const sunY = this.horizonY;

    for (let i = 5; i >= 1; i--) {   // outward bloom
      g.fillStyle(t.sun, 0.05 * i * 0.5);
      g.slice(this.cx, sunY, R * (1 + i * 0.10), Math.PI, 0, false);
      g.fillPath();
    }
    g.fillStyle(t.sun, 0.55);
    g.slice(this.cx, sunY, R, Math.PI, 0, false);
    g.fillPath();
    g.fillStyle(0xffffff, 0.30);
    g.slice(this.cx, sunY, R * 0.86, Math.PI, 0, false);
    g.fillPath();

    // horizontal scan bands cut out of the dome
    g.fillStyle(t.sky, 0.92);
    for (let i = 1; i <= 5; i++) {
      const yy = sunY - (i / 6) * R;
      const half = Math.sqrt(Math.max(0, R * R - (sunY - yy) ** 2));
      g.fillRect(this.cx - half, yy, half * 2, Math.max(1.5, R * 0.045));
    }

    // dashed ring of segments around the dome
    const segs = 34;
    for (let i = 0; i <= segs; i++) {
      const a = Math.PI + (i / segs) * Math.PI;
      if (i % 2) continue;
      const rr = R * 1.14;
      const x1 = this.cx + Math.cos(a) * rr, y1 = sunY + Math.sin(a) * rr;
      const x2 = this.cx + Math.cos(a) * (rr + 7), y2 = sunY + Math.sin(a) * (rr + 7);
      this.glowLine(g, x1, y1, x2, y2, t.sun, 2.5, 0.7);
    }

    // --- wireframe mountains ---
    let mx = b.x - 10;
    while (mx < b.x + b.width) {
      const w = b.width * (0.09 + ((Math.abs(Math.sin(mx * 0.07)) * 0.06)));
      const h = 16 + Math.abs(Math.sin(mx * 0.13)) * 30;
      const peakX = mx + w / 2, peakY = this.horizonY - h;
      this.glowPoly(g, [mx, this.horizonY, peakX, peakY, mx + w, this.horizonY],
        0x000000, 0.85, t.rail, 0.5, 2);
      // inner ridge line for the low-poly look
      g.lineStyle(1, t.rail, 0.28);
      g.lineBetween(peakX, peakY, peakX - w * 0.16, this.horizonY);
      mx += w * 0.92;
    }

    // --- ground + horizon ---
    g.fillStyle(0x01030a, 1);
    g.fillRect(b.x + 2, this.horizonY, b.width - 4, b.y + b.height - this.horizonY - 2);
    this.glowLine(g, b.x + 4, this.horizonY, b.x + b.width - 4, this.horizonY, t.rail, 2, 0.85);

    // --- floor grid outside the road ---
    const roadHalf = Math.ceil((LANES - 1) / 2 + 0.62);
    for (let i = -9; i <= 9; i++) {
      if (Math.abs(i) <= roadHalf) continue;
      const xNear = this.cx + i * this.laneGap * 1.2;
      g.lineStyle(1, t.rail, 0.16);
      g.lineBetween(this.cx, this.horizonY, xNear, b.y + b.height - 2);
    }
    for (let k = 1; k <= 14; k++) {
      const p = k / 3.2;
      const y = this.yAt(p);
      if (y > b.y + b.height - 2) break;
      g.lineStyle(1, t.rail, 0.10 + 0.18 * this.scaleAt(p));
      g.lineBetween(b.x + 4, y, b.x + b.width - 4, y);
    }
  }

  // ------------------------------------------------------------- per-frame art

  /** Spectrum bars marching down both shoulders of the road. */
  drawEqualiser(beat, pulse) {
    const g = this.eqGfx;
    const t = this.theme;
    g.clear();
    const farP = APPROACH_BEATS / 3;
    const outer = (LANES - 1) / 2 + 0.95;
    const crush = this.crushActive ? this.crushIntensity : 0;
    const rail = this.boostActive ? BOOST_GLOW : this.crushActive ? this.crushColor : t.rail;
    const bars = EQ_BARS + (this.crushActive ? 8 : this.boostActive ? 5 : 0);

    for (let i = 0; i < bars; i++) {
      const f = i / bars;
      const p = f * farP;
      const s = this.scaleAt(p);
      if (s < 0.02) continue;

      // Pseudo-spectrum: layered sines keep it lively without real FFT data.
      const amp = (0.22 + 0.78 * Math.abs(
        Math.sin(i * 1.7 + beat * 2.1) * 0.6 + Math.sin(i * 0.6 - beat * 1.3) * 0.4));
      const h = amp * 74 * s * (0.75 + pulse * 0.45 + crush * 0.45);
      const w = Math.max(1, 9 * s);
      const y = this.yAt(p);
      const a = Math.min(1, 0.30 + 0.45 * s + crush * 0.18 + (this.boostActive ? 0.12 : 0));

      for (const side of [-outer, outer]) {
        const x = this.xAt((LANES - 1) / 2 + side, p);
        g.fillStyle(rail, a * 0.22);
        g.fillRect(x - w * 1.6, y - h, w * 3.2, h);
        g.fillStyle(this.boostActive ? BOOST_LENS : this.crushActive ? this.crushGlow : t.glow, a);
        g.fillRect(x - w / 2, y - h, w, h);
      }
    }
  }

  /** High-streak presentation: side speed ticks, pulse ring and compact counter. */
  drawCrushFx(beat, pulse) {
    const g = this.crushGfx;
    g.clear();
    if (!this.crushActive && !this.boostActive) {
      this.crushText?.setAlpha(0);
      return;
    }

    if (this.boostActive) this.drawBoostRushFx(g, beat, pulse);
    if (!this.crushActive) {
      this.crushText?.setAlpha(0);
      return;
    }

    const intensity = this.crushIntensity;
    const color = this.crushColor;
    const glow = this.crushGlow;
    const outer = (LANES - 1) / 2 + 0.95;
    const ticks = 16 + this.crushLevel * 3;

    // Reference 2's tilted/rushing view is expressed as denser side ticks that
    // stretch toward the player. They sit outside the playable lanes, so they
    // add speed without obscuring a tile or changing the hitbox.
    for (let i = 0; i < ticks; i++) {
      const p = (i / ticks) * (APPROACH_BEATS / 3);
      const s = this.scaleAt(p);
      const y = this.yAt(p);
      const len = (8 + 16 * intensity) * s;
      for (const side of [-1, 1]) {
        const x = this.xAt((LANES - 1) / 2 + side * outer, p);
        this.glowLine(g, x, y, x + side * len, y + (10 + 16 * s),
          i % 3 === 0 ? glow : color, Math.max(1, 1.5 * s), 0.35 + intensity * 0.5);
      }
    }

    // A pulse behind the ball makes the streak feel physical without adding a
    // second landing tile. The pulse is fed by each successful resolution.
    const ring = 34 + (1 - this.crushPulse) * 24 + pulse * 8;
    g.lineStyle(2.5 + intensity * 2, glow, 0.22 + this.crushPulse * 0.55);
    g.strokeCircle(this.ballX, this.ballY + this.rushPitch, ring);

    this.crushText
      ?.setText(`×${this.combo}`)
      .setColor('#' + color.toString(16).padStart(6, '0'))
      .setPosition(this.cx + Math.sin(beat * 2.5) * (2 + intensity * 3),
        this.horizonY - 26 + Math.sin(beat * 3.5) * 2)
      .setScale(1.16 + this.crushPulse * 0.24 + intensity * 0.06)
      .setAlpha(0.82 + pulse * 0.18);

  }

  /** Boost adds a clean forward streak without reusing the Crush label. */
  drawBoostRushFx(g, beat, pulse) {
    const outer = (LANES - 1) / 2 + 0.95;
    const ticks = 20;
    for (let i = 0; i < ticks; i++) {
      const p = (i / ticks) * (APPROACH_BEATS / 2.6);
      const s = this.scaleAt(p);
      const y = this.yAt(p);
      const len = (10 + 18 * pulse) * s;
      for (const side of [-1, 1]) {
        const x = this.xAt((LANES - 1) / 2 + side * outer, p);
        this.glowLine(g, x, y, x + side * len, y + (14 + 12 * s),
          i % 2 ? BOOST_GLOW : BOOST_LENS, Math.max(1, 1.5 * s), 0.30 + pulse * 0.32);
      }
    }
    const ring = 42 + pulse * 12;
    g.lineStyle(2.5, BOOST_GLOW, 0.24 + pulse * 0.28);
    g.strokeCircle(this.ballX, this.ballY + this.rushPitch, ring);
    g.lineStyle(1.5, BOOST_LENS, 0.18 + pulse * 0.18);
    g.strokeCircle(this.ballX, this.ballY + this.rushPitch, ring + 12);
    // Small forward chevrons above the ball, a silhouette cue rather than text.
    const y = this.ballY - 58 - pulse * 6;
    this.glowLine(g, this.ballX - 18, y + 8, this.ballX, y - 8,
      BOOST_GLOW, 2, 0.58);
    this.glowLine(g, this.ballX, y - 8, this.ballX + 18, y + 8,
      BOOST_GLOW, 2, 0.58);
  }

  /** Road surface, neon rails, and the ball's lane projected up-road. */
  drawRoad(pulse) {
    const g = this.roadGfx;
    const t = this.theme;
    g.clear();
    const roadRail = this.boostActive ? BOOST_GLOW : this.crushActive ? this.crushColor : t.rail;
    const laneKey = this.boostActive ? BOOST_KEY : this.crushActive ? this.crushColor : t.key;

    const farP = APPROACH_BEATS / 3;
    const L = -0.62, R = LANES - 1 + 0.62;

    // road slab
    this.glowPoly(g, [
      this.xAt(L, farP), this.yAt(farP), this.xAt(R, farP), this.yAt(farP),
      this.xAt(R, 0), this.yAt(0), this.xAt(L, 0), this.yAt(0),
    ], 0x00060e, 0.94, 0x000000, 0);

    // the lane the ball is in, projected to the horizon. Without this you cannot
    // tell which lane a distant tile will arrive in — perspective pulls far
    // tiles toward the centre, so players aim where a tile LOOKS, not where it
    // is going to be.
    const bl = Phaser.Math.Clamp(this.laneAtX(this.ballX), -0.5, LANES - 0.5);
    g.fillStyle(laneKey, this.crushActive || this.boostActive ? 0.14 : 0.09);
    g.beginPath();
    g.moveTo(this.xAt(bl - HIT_TOLERANCE, farP), this.yAt(farP));
    g.lineTo(this.xAt(bl + HIT_TOLERANCE, farP), this.yAt(farP));
    g.lineTo(this.xAt(bl + HIT_TOLERANCE, 0), this.yAt(0));
    g.lineTo(this.xAt(bl - HIT_TOLERANCE, 0), this.yAt(0));
    g.closePath();
    g.fillPath();

    // neon rails
    for (const side of [L, R]) {
      this.glowLine(g, this.xAt(side, farP), this.yAt(farP),
        this.xAt(side, 0), this.yAt(0), roadRail, 3, 0.55 + pulse * 0.4);
    }
    // faint lane dividers
    g.lineStyle(1, roadRail, this.crushActive || this.boostActive ? 0.28 : 0.16);
    for (let l = 0; l < LANES - 1; l++) {
      g.lineBetween(this.xAt(l + 0.5, farP), this.yAt(farP), this.xAt(l + 0.5, 0), this.yAt(0));
    }

  }

  /** Guide rail dropping an approaching tile down its lane to the ball plane. */
  drawGuide(g, lane, p, color, aligned) {
    g.lineStyle(aligned ? 2 : 1, color, aligned ? 0.45 : 0.14);
    g.lineBetween(this.xAt(lane, p), this.yAt(p), this.xAt(lane, 0), this.yAt(0));
  }

  /**
   * A 3D slab spanning lanes [laneL..laneR] at depth p: a front face toward the
   * camera plus a top face receding into the distance, both rimmed with glow.
   * The front face is the difference between "a coloured rectangle" and "a
   * block sitting on a road".
   *
   * Note tiles draw through here. Mode gates intentionally do not: a full-width
   * slab at the same depth as a note reads as one accidental multi-lane tile.
   */
  drawSlab(g, laneL, laneR, p, halfDepth, key, glow, alpha, { height = TILE_HEIGHT, detail = true, topMul = 0.72 } = {}) {
    const pF = p + halfDepth;
    const pN = Math.max(-0.03, p - halfDepth);
    const sF = this.scaleAt(pF), sN = this.scaleAt(pN);
    const yF = this.yAt(pF), yN = this.yAt(pN);
    const hF = height * sF, hN = height * sN;
    const xLF = this.xAt(laneL, pF), xRF = this.xAt(laneR, pF);
    const xLN = this.xAt(laneL, pN), xRN = this.xAt(laneR, pN);

    // front face — darker, gives the slab its height
    this.glowPoly(g, [
      xLN, yN - hN, xRN, yN - hN, xRN, yN, xLN, yN,
    ], key, alpha * 0.55, glow, alpha * 0.75, 2);

    // top face — bright
    this.glowPoly(g, [
      xLF, yF - hF, xRF, yF - hF, xRN, yN - hN, xLN, yN - hN,
    ], key, alpha * topMul, glow, alpha, 3);

    // inset detail line, as in the reference art
    if (detail && sN > 0.28) {
      const inF = (xRF - xLF) * 0.29, inN = (xRN - xLN) * 0.29;
      g.lineStyle(1.5, 0xffffff, alpha * 0.35);
      g.beginPath();
      g.moveTo(xLF + inF, yF - hF); g.lineTo(xRF - inF, yF - hF);
      g.lineTo(xRN - inN, yN - hN); g.lineTo(xLN + inN, yN - hN);
      g.closePath(); g.strokePath();
    }
  }

  /** One note tile, centred on its lane. */
  drawTile(g, lane, p, key, glow, alpha, aligned, kind = TILE_KINDS.NORMAL) {
    const half = (this.tileW / 2) / this.laneGap;   // tile half-width in lane units
    const rush = this.rushPerspective;
    const special = kind === TILE_KINDS.TRAP || kind === TILE_KINDS.BOOST;
    const modelKey = kind === TILE_KINDS.TRAP ? TRAP_KEY
      : kind === TILE_KINDS.BOOST ? BOOST_KEY : key;
    const modelGlow = kind === TILE_KINDS.TRAP ? TRAP_GLOW
      : kind === TILE_KINDS.BOOST ? BOOST_GLOW : glow;
    const tileKey = rush && !special ? this.crushColor : modelKey;
    const tileGlow = rush && !special ? this.crushGlow : modelGlow;
    const height = TILE_HEIGHT * (1 + rush * 0.22 + (special ? 0.08 : 0));
    this.drawSlab(g, lane - half, lane + half, p, TILE_HALF_DEPTH, tileKey, tileGlow, alpha,
      { height, topMul: aligned ? 0.98 : (0.76 + rush * 0.12) });

    if (kind === TILE_KINDS.TRAP) {
      this.drawTrapModel(g, lane, p, height, alpha, aligned);
      return;
    }
    if (kind === TILE_KINDS.BOOST) {
      this.drawBoostModel(g, lane, p, height, alpha, aligned);
      return;
    }

    // A pair of inset speed grooves makes rush tiles read as a new platform
    // type without drawing a second rectangle or changing the hitbox.
    if (rush && this.scaleAt(p) > 0.20) {
      const s = this.scaleAt(p);
      const x = this.xAt(lane, p);
      const y = this.yAt(p) - height * s * 0.35;
      const groove = this.tileW * s * 0.18;
      g.lineStyle(1.5 + rush * 1.3, tileGlow, alpha * (0.55 + rush * 0.35));
      g.lineBetween(x - groove, y, x + groove, y - 7 * s);
      g.lineBetween(x - groove, y - 7 * s, x + groove, y);
    }
  }

  /** Raised clamp teeth and a warning cross make a Trap read in 3D. */
  drawTrapModel(g, lane, p, height, alpha, aligned) {
    const s = this.scaleAt(p);
    if (s < 0.10) return;
    const x = this.xAt(lane, p);
    const top = this.yAt(p) - height * s * 0.76;
    const half = this.tileW * s * 0.34;
    const toothY = top - (11 + (aligned ? 3 : 0)) * s;
    const pulse = 0.75 + 0.25 * Math.sin(this.conductor.beat * Math.PI * 2);

    for (const side of [-1, 1]) {
      const bx = x + side * half;
      this.glowPoly(g, [
        bx, top + 3 * s,
        bx - side * half * 0.34, toothY,
        bx - side * half * 0.68, top + 4 * s,
      ], TRAP_KEY, alpha * 0.62, TRAP_GLOW, alpha * (0.72 + pulse * 0.2), 2);
      this.glowLine(g, bx, top, x + side * half * 0.22, toothY + 2 * s,
        TRAP_GLOW, Math.max(1, 2.5 * s), alpha * (0.5 + pulse * 0.3));
    }
    this.glowLine(g, x - half * 0.82, top + 1 * s, x + half * 0.82, toothY + 3 * s,
      TRAP_GLOW, Math.max(1, 2 * s), alpha * 0.82);
    this.glowLine(g, x + half * 0.82, top + 1 * s, x - half * 0.82, toothY + 3 * s,
      TRAP_GLOW, Math.max(1, 2 * s), alpha * 0.82);
  }

  /** A central lens/arrow core and side chevrons make Boost unmistakable. */
  drawBoostModel(g, lane, p, height, alpha, aligned) {
    const s = this.scaleAt(p);
    if (s < 0.10) return;
    const x = this.xAt(lane, p);
    const top = this.yAt(p) - height * s * 0.80;
    const lensW = this.tileW * s * (aligned ? 0.18 : 0.14);
    const chevron = this.tileW * s * 0.34;
    const pulse = 0.75 + 0.25 * Math.sin(this.conductor.beat * Math.PI * 2.5);

    this.glowPoly(g, [
      x, top - 10 * s, x + lensW, top, x, top + 10 * s, x - lensW, top,
    ], BOOST_LENS, alpha * 0.78, BOOST_GLOW, alpha * (0.82 + pulse * 0.15), 2);
    this.glowLine(g, x - chevron, top + 18 * s, x, top - 4 * s,
      BOOST_GLOW, Math.max(1, 2.5 * s), alpha * 0.85);
    this.glowLine(g, x, top - 4 * s, x + chevron, top + 18 * s,
      BOOST_GLOW, Math.max(1, 2.5 * s), alpha * 0.85);
    this.glowLine(g, x - chevron * 0.65, top + 24 * s, x, top + 7 * s,
      BOOST_LENS, Math.max(1, 1.5 * s), alpha * (0.46 + pulse * 0.3));
    this.glowLine(g, x, top + 7 * s, x + chevron * 0.65, top + 24 * s,
      BOOST_LENS, Math.max(1, 1.5 * s), alpha * (0.46 + pulse * 0.3));
  }

  /**
   * The MODE GATE: a timing-only threshold for the attack/defend handoff.
   *
   * Red means the enemy is about to attack and you must defend; green means the
   * floor is yours. It spans every lane, so it cannot be missed or dodged — it
   * is a transition marker, not a challenge. Crossing it IS the mode change.
   * It deliberately has no persistent geometry: a full-width line or chevron
   * still reads as a three-lane tile when a normal note is nearby.
   */
  drawGate(g, gate, beat, approach) {
    const p = (gate.beat - beat) / approach;
    // Gates follow the same sight line as tiles, so a Jam hides the upcoming
    // handoff too — you feel the mode change instead of reading it.
    if (p > this.visibleBeats / APPROACH_BEATS || p < -0.14) return;
  }

  /** Floating "DEFEND" / "ATTACK" label telegraphing the next handoff. */
  drawGateLabel(gate, beat, approach) {
    if (!this.gateLabel) return;
    const p = (gate.beat - beat) / approach;
    if (p > this.visibleBeats / APPROACH_BEATS || p < -0.14) {
      this.gateLabel.setAlpha(0);
      return;
    }

    const isEnemy = gate.type === 'enemy';
    const s = this.scaleAt(p);
    this.gateLabel
      .setText(isEnemy ? 'DEFEND' : 'ATTACK')
      .setColor(isEnemy ? '#ff6b8f' : '#6bffa8')
      .setPosition(this.cx, this.yAt(p) - (TILE_HEIGHT * 1.5 + 26) * s)
      .setScale(Phaser.Math.Clamp(s * 1.6, 0.35, 1.5))
      .setAlpha(Math.min(1, (1 - p) * 2.2));
  }

  /** Fired the instant the ball passes through a gate. */
  onGateCrossed(gate) {
    const isEnemy = gate.type === 'enemy';
    const color = isEnemy ? 0xff1f57 : 0x14ff7a;
    const b = this.bounds;
    const s = this.scene;

    // Sheet of light sweeping up the road as you pass through.
    const sweep = s.add.rectangle(this.cx, this.yAt(0), b.width, 10, color, 0.75);
    this.layer.add(sweep);
    s.tweens.add({
      targets: sweep, y: this.horizonY, scaleX: 0.15, scaleY: 3, alpha: 0,
      duration: 420, ease: 'Quad.easeOut',
      onComplete: () => sweep.destroy(),
    });

    // Ball flashes the incoming mode colour, then settles back to white.
    this.ball.setFillStyle(color);
    s.time.delayedCall(180, () => this.ball?.setFillStyle(0xffffff));

    this.opts.onGateCrossed?.(gate);
  }

  // ------------------------------------------------------------- input

  onPointerMove(pointer) {
    const b = this.bounds;
    const local = this.inverseViewPoint(pointer.x, pointer.y);
    if (local.x < b.x - 60 || local.x > b.x + b.width + 60) return;

    const now = performance.now();
    const dx = pointer.x - this._lastPtrX;
    if (this.trapState && Math.abs(dx) >= TRAP_GESTURE_MIN_PX) {
      const dir = Math.sign(dx);
      if (this.trapState.lastGestureDir && dir !== this.trapState.lastGestureDir) {
        this.trapState.progress = Math.min(1,
          this.trapState.progress + 1 / TRAP_ESCAPE_STEPS);
        this.trapState.pulse = 1;
      }
      this.trapState.lastGestureDir = dir;
      this.trapState.lastGestureAt = now;
    }

    // A caught ball stays on the trap platform while the cursor movement is
    // reinterpreted as the escape gesture. Upcoming tiles continue to travel.
    if (this.trapState) {
      this.targetX = this.trapState.anchorX;
      this._lastPtrX = pointer.x;
      this._lastPtrT = now;
      return;
    }
    const min = this.xAt(-0.35, 0);
    const max = this.xAt(LANES - 1 + 0.35, 0);
    this.targetX = Phaser.Math.Clamp(local.x, min, max);

    // GAME_PLAN B4: flick detection. Fast horizontal pointer motion triggers a
    // short dash — extra steering + a neon trail.
    if (this._lastPtrT !== undefined) {
      const dt = now - this._lastPtrT;
      if (dt > 0 && Math.abs(pointer.x - this._lastPtrX) / dt * 1000 > DASH_VX) {
        this.dashUntil = now + DASH_MS;
      }
    }
    this._lastPtrX = pointer.x;
    this._lastPtrT = now;
  }

  get crushIntensity() {
    if (!this.crushActive) return 0;
    return Phaser.Math.Clamp(0.45 + (this.combo - CRUSH_START) * 0.012, 0.45, 1);
  }

  get boostActive() {
    return this.conductor.beat < this.boostUntilBeat;
  }

  get boostRemainingMs() {
    if (!this.boostActive) return 0;
    return Math.max(0, (this.boostUntilBeat - this.conductor.beat) * this.conductor.msPerBeat);
  }

  get crushColor() {
    return this.crushLevel % 2 ? CRUSH_MAGENTA : CRUSH_CYAN;
  }

  get crushGlow() {
    return this.crushLevel % 2 ? 0xffa8f0 : 0xb9f8ff;
  }

  /**
   * Combo is owned by RunState/LevelScene; BallHop only presents its rush.
   * Every ten hits after the threshold adds another speed tier, capped so the
   * player can still read the lane changes.
   */
  setCombo(combo) {
    const next = Math.max(0, Math.floor(Number(combo) || 0));
    const wasCrush = this.crushActive;
    this.combo = next;
    this.crushActive = next >= CRUSH_START;
    this.crushLevel = this.crushActive
      ? Math.min(6, 1 + Math.floor((next - CRUSH_START) / 10))
      : 0;
    this.crushSpeed = this.crushActive
      ? Math.min(CRUSH_MAX_SPEED, 1.15 + (next - CRUSH_START) * 0.012)
      : 1;

    if (this.crushActive) {
      this.crushText?.setText(`×${next}`).setAlpha(1);
      if (!wasCrush) {
        this.crushPulse = 1;
        this.scene.cameras.main.flash?.(110, 255, 47, 214, false);
        music.sfx?.('milestone');
      }
    } else {
      this.crushText?.setText('').setAlpha(0);
      this.crushPulse = 0;
    }
    this.updateHint();
  }

  /** Effective note approach time, accelerated only during CRUSH. */
  approachBeats(base) {
    const normal = super.approachBeats(base);
    const rush = this.crushActive ? this.crushSpeed : 1;
    return this.boostActive ? normal / rush / BOOST_SPEED : normal / rush;
  }

  updateHint() {
    if (!this.hintText) return;
    if (this.trapState) {
      this.hintText.setText('SWING LEFT / RIGHT — fill the escape line');
      return;
    }
    if (this.boostActive) {
      this.hintText.setText(
        `BOOST ${Math.ceil(this.boostRemainingMs / 1000)}s — land tiles for Lens`);
      return;
    }
    if (this.crushActive) {
      this.hintText.setText(
        `${Math.round(this.crushSpeed * 100)}% SPEED — hold your line`);
      return;
    }
    this.hintText.setText(
      this.speedTier > 1
        ? `${['CHILL', 'NORMAL', 'HURRY', 'FRENZY'][this.speedTier]} — hold your line`
        : 'DRAG TO PLAY — move the mouse, never click');
  }

  activateBoost(note, beat) {
    const beatDuration = this.conductor.msPerBeat || 500;
    this.boostUntilBeat = Math.max(this.boostUntilBeat, beat + BOOST_DURATION_MS / beatDuration);
    this.boostPulse = 1;
    note.boostActivated = true;
    music.sfx('boost');
    this.opts.onBoost?.(note);
    this.updateHint();
  }

  startTrap(note) {
    note.judged = true;
    note.drawn = false;
    // The paired normal tile is the alternate safe target. Once the player
    // lands on the hazard, do not later turn that partner into an unavoidable
    // MISS while the escape meter is being played.
    for (const partner of this.notes) {
      if (partner === note || partner.kind === TILE_KINDS.TRAP) continue;
      if (Math.abs(partner.absBeat - note.absBeat) < 1e-6) {
        partner.judged = true;
        partner.trapCompanionSkipped = true;
        partner.drawn = false;
      }
    }
    this.trapState = {
      note,
      lane: note.lane,
      anchorX: this.xAt(note.lane, 0),
      progress: 0,
      lastGestureDir: 0,
      lastGestureAt: performance.now(),
      startedAt: performance.now(),
      pulse: 1,
    };
    this.targetX = this.trapState.anchorX;
    this.trapMeterText?.setAlpha(1);
    music.sfx('trap');
    this.opts.onTrapStart?.(note);
    this.updateHint();
  }

  resolveTrap(escaped) {
    const state = this.trapState;
    if (!state) return;
    this.trapState = null;
    state.note.trapEscaped = !!escaped;
    state.note.trapFailed = !escaped;
    this.trapMeterText?.setAlpha(0);
    this.trapMeterGfx?.clear();
    // Trap hazards are not scoreable notes. Escaping clears the hazard without
    // granting a free hit, and timing out does not break the combo either.
    this.opts.onTrapResolved?.(state.note, escaped);
    this.updateHint();
  }

  /** Turn a successful, player-landed tile into one Lens during Boost. */
  rewardBoostHit(note, judgment) {
    if (!this.boostActive || judgment.weight <= 0
      || note.kind === TILE_KINDS.TRAP || note.lensSpawned) return;
    note.lensSpawned = true;
    note.pointFromBoost = true;
    this.spawnLens(note);
  }

  spawnLens(note) {
    this.lensPickups.push({
      lane: note.lane,
      bornAt: performance.now(),
      seed: note.absBeat * 17.13,
    });
    this.opts.onLensCollected?.(1, note);
    music.sfx('lens');
  }

  drawLensPickups() {
    const g = this.pickupGfx;
    g.clear();
    const now = performance.now();
    const live = [];
    for (const pickup of this.lensPickups) {
      const age = now - pickup.bornAt;
      if (age >= LENS_PICKUP_TTL_MS) continue;
      live.push(pickup);
      const t = age / LENS_PICKUP_TTL_MS;
      const p = Math.max(0, 0.16 - t * 0.10);
      const s = this.scaleAt(p);
      const x = this.xAt(pickup.lane, p) + Math.sin(pickup.seed + t * 8) * 5 * s;
      const y = this.yAt(p) - 28 * s - t * 34;
      const w = (9 + 4 * Math.sin(t * Math.PI)) * s;
      const alpha = 1 - t * 0.82;
      this.glowPoly(g, [x, y - w * 1.45, x + w, y, x, y + w * 1.45, x - w, y],
        BOOST_LENS, alpha * 0.75, BOOST_GLOW, alpha, 2);
      this.glowLine(g, x - w * 0.36, y - w * 0.7, x + w * 0.36, y + w * 0.7,
        0xffffff, Math.max(1, 1.1 * s), alpha * 0.72);
    }
    this.lensPickups = live;
  }

  drawTrapMeter() {
    const g = this.trapMeterGfx;
    g.clear();
    if (!this.trapState) {
      this.trapMeterText?.setAlpha(0);
      return;
    }
    const b = this.bounds;
    const w = Math.min(280, b.width * 0.62);
    const h = 10;
    const x = this.cx - w / 2;
    const y = b.y + b.height - 48;
    const pulse = 0.55 + 0.45 * Math.sin(performance.now() * 0.012);
    g.fillStyle(0x080812, 0.92);
    g.fillRoundedRect(x, y, w, h, 5);
    g.lineStyle(1.5, TRAP_GLOW, 0.45 + pulse * 0.25);
    g.strokeRoundedRect(x, y, w, h, 5);
    g.fillStyle(TRAP_GLOW, 0.85);
    g.fillRoundedRect(x + 2, y + 2, (w - 4) * this.trapState.progress, h - 4, 3);
    this.trapMeterText
      ?.setPosition(this.cx, y - 14)
      .setText(`TRAP  ${Math.round(this.trapState.progress * 100)}%`)
      .setColor('#' + TRAP_GLOW.toString(16).padStart(6, '0'))
      .setAlpha(0.84 + pulse * 0.16);
  }

  setSpeedTier(tier) {
    this.speedTier = tier;
    this.updateHint();
  }

  startPhrase(phrase) {
    super.startPhrase(phrase);
    this.beginViewDrift();
    const isEnemy = phrase.type === 'enemy';
    this.setTheme(isEnemy ? THEMES.enemy : THEMES.hero);
    for (const n of this.notes) {
      n.kind = n.kind || TILE_KINDS.NORMAL;
      n.key = this.theme.key;
      n.glow = this.theme.glow;
      n.drawn = false;
      this.opts.onNoteSpawn?.(n);
    }
  }

  // ------------------------------------------------------------- loop

  update() {
    if (!this.conductor.isPlaying) return;
    const beat = this.conductor.beat;
    const phase = this.conductor.beatPhase;
    const pulse = 1 - phase;
    this.crushPulse = Math.max(0, this.crushPulse * 0.88 - 0.012);
    this.boostPulse = Math.max(0, this.boostPulse * 0.88 - 0.012);
    this.advanceViewDrift();

    if (this.trapState) {
      this.trapState.pulse = Math.max(0, this.trapState.pulse * 0.86 - 0.018);
      // Repeated sixths can land just below one in floating point, so use a
      // tiny epsilon at the completion threshold. The meter should never ask
      // for a phantom seventh swing after the visual bar is full.
      if (this.trapState.progress >= 1 - 1e-6) this.resolveTrap(true);
      else if (performance.now() - this.trapState.startedAt >= TRAP_ESCAPE_MS) this.resolveTrap(false);
    }

    // --- ball: eased steering + rhythmic hop ---
    // Lag between cursor and ball reads as unfairness, so keep this snappy.
    const now = performance.now();
    const dashing = now < this.dashUntil;
    const prevX = this.ballX;
    if (this.trapState) this.targetX = this.trapState.anchorX;
    this.ballX += (this.targetX - this.ballX) * (dashing ? STEER_LERP * DASH_STEER : STEER_LERP);
    const hop = Math.abs(Math.sin(phase * Math.PI)) * HOP_HEIGHT;
    const squash = 1 + Math.cos(phase * Math.PI * 2) * 0.10;
    const by = this.ballY + this.rushPitch - 17 - hop;

    const ballPoint = this.viewPoint(this.ballX, by);
    this.ball.setPosition(ballPoint.x, ballPoint.y);
    this.ball.setScale(squash, 2 - squash);
    // While dashing the halo flares, making the burst readable at a glance.
    this.ballHalo1.setPosition(ballPoint.x, ballPoint.y).setScale(1 + hop / 130)
      .setAlpha(dashing ? 0.30 : 0.16);
    this.ballHalo2.setPosition(ballPoint.x, ballPoint.y).setScale(1 + hop / 90);

    // Dash trail: each ghost inherits the one ahead; the newest sits where the
    // ball was a frame ago. Off-dash the ghosts just fade out.
    if (dashing) {
      for (let i = this.ghosts.length - 1; i > 0; i--) {
        const g = this.ghosts[i];
        this.ghostPositions[i].x = this.ghostPositions[i - 1].x;
        this.ghostPositions[i].y = this.ghostPositions[i - 1].y;
        const ghostPoint = this.viewPoint(this.ghostPositions[i].x, this.ghostPositions[i].y);
        g.setVisible(true).setPosition(ghostPoint.x, ghostPoint.y).setAlpha(g.alpha);
      }
      this.ghostPositions[0].x = prevX;
      this.ghostPositions[0].y = by;
      const ghostPoint = this.viewPoint(prevX, by);
      this.ghosts[0].setVisible(true).setPosition(ghostPoint.x, ghostPoint.y).setAlpha(0.35);
    } else {
      for (const g of this.ghosts) {
        if (g.alpha <= 0.02) { g.setVisible(false); continue; }
        g.setAlpha(g.alpha - 0.07);
      }
    }
    const shadowPoint = this.viewPoint(this.ballX, this.ballY + this.rushPitch + 6);
    this.ballShadow.setPosition(shadowPoint.x, shadowPoint.y)
      .setScale(1 - hop / 150).setAlpha(0.5 - hop / 190);

    this.drawEqualiser(beat, pulse);
    this.drawRoad(pulse);
    this.drawCrushFx(beat, pulse);

    const approach = this.approachBeats(APPROACH_BEATS);
    const g = this.tileGfx;
    g.clear();

    // The gate is drawn even between phrases, because that gap is exactly when
    // the player most needs to see what is coming.
    if (this.gate) {
      this.drawGate(g, this.gate, beat, approach);
      this.drawGateLabel(this.gate, beat, approach);
      if (!this.gate.crossed && beat >= this.gate.beat) {
        this.gate.crossed = true;
        this.onGateCrossed(this.gate);
      }
    } else if (this.gateLabel) {
      this.gateLabel.setAlpha(0);
    }

    // Sight line: normally well past the gate, cut short while Jammed.
    const limit = this.visibleBeats;
    const ballLaneNow = this.laneAtX(this.ballX);

    // Draw far-to-near so nearer slabs correctly overlap distant ones.
    const visible = [];
    const collect = (list, preview) => {
      for (const n of list) {
        if (n.judged) continue;
        const beatsAway = n.absBeat - beat;
        if (beatsAway > limit || beatsAway < -0.25) { n.drawn = false; continue; }
        n.drawn = true;
        visible.push({ n, p: beatsAway / approach, preview });
        // GAME_PLAN A3: a soft approach tick as a real tile enters its final
        // beat — an ear-level cue for players who read by sound. Preview tiles
        // stay silent so the next phrase never bleeds into this one.
        if (!preview && !n.ticked && beatsAway <= 1 && beatsAway > 0.5) {
          n.ticked = true;
          music.sfx('tick');
        }
      }
    };
    collect(this.notes, false);
    collect(this.upcoming, true);        // the road continues past the gate
    visible.sort((a, b2) => b2.p - a.p);

    for (const { n, p, preview } of visible) {
      // Preview tiles take their colour from THEIR phrase, so a red stretch
      // beyond a red gate reads as "the enemy's turn is coming".
      const key = preview ? (n.phraseType === 'enemy' ? THEMES.enemy.key : THEMES.hero.key) : n.key;
      const glowC = preview ? (n.phraseType === 'enemy' ? THEMES.enemy.glow : THEMES.hero.glow) : n.glow;

      // GAME_PLAN B4 hyperfruit: a tile that is still too far to reach in the
      // time left pulses magenta — the game itself warning that a dash is
      // needed (osu!catch's hyperfruit telegraph).
      const beatsAway = n.absBeat - beat;
      const reach = (dashing ? HYPER_DASH_LANES_PER_BEAT : HYPER_LANES_PER_BEAT) * beatsAway;
      const hyper = !preview && beatsAway > 0 && beatsAway <= HYPER_BEATS
        && Math.abs(ballLaneNow - n.lane) > reach + 0.5;

      const aligned = !preview && Math.abs(ballLaneNow - n.lane) <= HIT_TOLERANCE;
      if (!preview && p < 0.55) this.drawGuide(g, n.lane, p, glowC, aligned && p < 0.35);

      // Distant tiles fade out rather than popping in at the sight limit.
      const dist = Phaser.Math.Clamp(1 - (n.absBeat - beat) / limit, 0, 1);
      const alpha = Math.min(1, 0.25 + 0.75 * dist) * (preview ? 0.75 : 1);

      // Hyperfruit tiles pulse; lined-up tiles brighten — feedback BEFORE the
      // beat rather than only telling you after it has passed.
      const tileGlow = hyper ? 0xff2fd6 : (aligned ? 0xffffff : glowC);
      const tileAlpha = hyper ? alpha * (0.55 + 0.45 * pulse) : alpha;
      this.drawTile(g, n.lane, p, key, tileGlow, tileAlpha, aligned, n.kind);
    }

    this.drawLensPickups();
    this.drawTrapMeter();
    this.updateHint();

    this.applyViewTransform();

    if (!this.active) return;

    // --- judging ---
    //
    // THIS IS A STEERING GAME, NOT A CLICKING GAME. The ball hops on its own, so
    // the player controls position, never timing. Grading is therefore purely
    // "where were you when the beat landed".
    //
    // An earlier version opened a +/-135ms window and resolved on the FIRST frame
    // inside it, charging that 135ms as timing error. Being in the right lane
    // early — which is good play — scored GOOD at best, and MISS if you were 0.1
    // lanes off centre. That was the "cursor is on it but I miss" bug: click-game
    // logic pasted into a steering game.
    const ballLane = this.laneAtX(this.ballX);

    // Trap tiles are hazards, not score targets. If the ball reaches a trap
    // lane, start the escape interaction and suppress its paired safe tile for
    // that beat. If the ball stays on the safe lane, silently retire the trap
    // so avoiding it never emits a MISS or breaks combo.
    for (const trap of this.notes) {
      if (trap.judged || trap.kind !== TILE_KINDS.TRAP) continue;
      const trapErrMs = (beat - trap.absBeat) * this.conductor.msPerBeat;
      if (trapErrMs < 0) continue;
      if (Math.abs(ballLane - trap.lane) <= HIT_TOLERANCE) {
        this.startTrap(trap);
      } else {
        trap.judged = true;
        trap.skippedTrap = true;
        trap.drawn = false;
      }
    }

    for (const n of this.notes) {
      if (n.judged) continue;
      // If the player landed on a trap, its same-beat safe partner is no longer
      // reachable and must not be converted into a miss while escaping.
      if (this.trapState && Math.abs(n.absBeat - this.trapState.note.absBeat) < 1e-6) continue;
      const errMs = (beat - n.absBeat) * this.conductor.msPerBeat;
      if (errMs < -SAMPLE_MS) continue;

      const d = Math.abs(ballLane - n.lane);
      n.bestDist = n.bestDist === undefined ? d : Math.min(n.bestDist, d);

      if (errMs >= 0) {
        const dist = n.bestDist;
        if (dist <= HIT_TOLERANCE) {
          if (n.kind === TILE_KINDS.TRAP) {
            this.startTrap(n);
            continue;
          }
          if (n.kind === TILE_KINDS.BOOST) {
            this.activateBoost(n, n.absBeat);
            this.resolve(n, JUDGMENTS.PERFECT);
            continue;
          }
          // Dead centre -> PERFECT, tile edge -> GOOD, smooth in between.
          this.resolve(n, judge((dist / HIT_TOLERANCE) * (JUDGMENTS.GOOD.window - 1),
            this.speedTier));
        } else {
          this.resolve(n, JUDGMENTS.MISS);
        }
      }
    }
  }

  resolve(note, judgment) {
    note.judged = true;
    note.drawn = false;
    const s = this.scene;
    const x = this.xAt(note.lane, 0);
    const y = this.yAt(0);
    const point = this.viewPoint(x, y);
    const vx = point.x;
    const vy = point.y;

    if (this.crushActive && judgment.weight > 0) this.crushPulse = 1;
    if (this.boostActive && judgment.weight > 0) this.boostPulse = 1;

    if (judgment.weight > 0) {
      const ring = s.add.ellipse(vx, vy, this.tileW * 1.1, this.tileW * 0.4, judgment.color, 0);
      ring.setStrokeStyle(3, judgment.color, 0.95);
      this.layer.add(ring);
      s.tweens.add({
        targets: ring, scaleX: 2.8, scaleY: 2.8, alpha: 0,
        duration: 360, onComplete: () => ring.destroy(),
      });
      const flash = s.add.circle(vx, vy - 14, 26, judgment.color, 0.45);
      this.layer.add(flash);
      s.tweens.add({
        targets: flash, scale: 2.2, alpha: 0, duration: 300,
        onComplete: () => flash.destroy(),
      });
      for (let i = 0; i < 6; i++) {
        const sp = s.add.circle(vx, vy - 8, 3, judgment.color, 0.95);
        this.layer.add(sp);
        s.tweens.add({
          targets: sp,
          x: vx + Phaser.Math.Between(-58, 58),
          y: vy - Phaser.Math.Between(20, 70),
          alpha: 0, scale: 0.2, duration: 420,
          onComplete: () => sp.destroy(),
        });
      }
    } else {
      const cross = s.add.text(vx, vy - 20, '✕', {
        fontFamily: 'Trebuchet MS', fontSize: '26px', color: '#ff4d6d',
      }).setOrigin(0.5);
      this.layer.add(cross);
      s.tweens.add({
        targets: cross, y: vy - 58, alpha: 0, duration: 500,
        onComplete: () => cross.destroy(),
      });
    }
    this.rewardBoostHit(note, judgment);
    this.emitJudgment(judgment, note);
  }

  endPhrase() {
    // A phrase boundary cannot leave the ball visually caught with no further
    // input. Clear an unfinished hazard interaction without judging it, then
    // let the base class clear the phrase state.
    if (this.trapState) this.resolveTrap(false);
    super.endPhrase();
    for (const n of this.notes) {
      if (n.kind === TILE_KINDS.TRAP || n.skippedTrap || n.trapCompanionSkipped) {
        n.judged = true;
        continue;
      }
      if (!n.judged) { n.judged = true; this.emitJudgment(JUDGMENTS.MISS, n); }
    }
    this.notes = [];
    this.tileGfx?.clear();
  }

  destroy() {
    this.scene.input.off('pointermove', this.onPointerMove, this);
    super.destroy();
  }
}

registerMiniGame(BallHop);
