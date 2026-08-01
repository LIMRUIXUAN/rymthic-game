/**
 * Headless UI-logic test.
 *
 * `vite build` proves the code parses. It does NOT prove that EnemyPanel.create()
 * or BallHop.update() run without throwing — and a game that builds cleanly but
 * throws on scene create is indistinguishable from a broken one.
 *
 * The proper check is tests/smoke.mjs in a real browser. This file is the
 * fallback for environments without a working Chrome: it fakes just enough of
 * the Phaser scene API to actually construct the panels and minigames, then
 * drives a full level's worth of beats through them.
 *
 * Run:  node --experimental-vm-modules tests/scene.test.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';

let JSDOM;
try {
  // JSDOM_PATH is an escape hatch for sandboxes where jsdom lives outside the
  // project tree. Normal use just resolves it from node_modules.
  ({ JSDOM } = await import(process.env.JSDOM_PATH || 'jsdom'));
} catch {
  console.log('\n  Skipping scene tests: jsdom is not installed.\n');
  console.log('  To enable them:   npm i -D jsdom\n');
  process.exit(0);
}

// ---- minimal DOM so `import phaser` succeeds -------------------------------
const dom = new JSDOM('<!DOCTYPE html><div id="game"></div>', { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.self = dom.window;

// Phaser reaches for a lot of bare DOM globals at import time (Element, Node,
// CanvasRenderingContext2D, ...). Rather than guess which, mirror everything
// jsdom exposes that isn't already defined here.
for (const key of Object.getOwnPropertyNames(dom.window)) {
  if (key in globalThis) continue;
  try {
    Object.defineProperty(globalThis, key, {
      value: dom.window[key], writable: true, configurable: true,
    });
  } catch { /* some jsdom props are getter-only; skip them */ }
}

// Node 22 makes `navigator` getter-only, so it must be redefined not assigned.
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator, writable: true, configurable: true,
});
if (!globalThis.performance) globalThis.performance = dom.window.performance;

// jsdom has no real 2D context (that needs the native `canvas` package, which
// needs system libs). Phaser probes a canvas at import time for its inverse-alpha
// feature check, so give it a permissive fake. We never render here — the visual
// output is what tests/smoke.mjs checks in a real browser.
function fakeContext2D() {
  const target = {
    canvas: null, fillStyle: '', strokeStyle: '', globalCompositeOperation: '',
    globalAlpha: 1, font: '', textBaseline: '', lineWidth: 1,
    getImageData: () => ({ data: new Uint8ClampedArray([10, 20, 30, 128]), width: 1, height: 1 }),
    measureText: () => ({ width: 10 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({}),
  };
  return new Proxy(target, {
    get: (t, p) => (p in t ? t[p] : () => undefined),
    set: (t, p, v) => { t[p] = v; return true; },
  });
}
dom.window.HTMLCanvasElement.prototype.getContext = function (kind) {
  if (kind === '2d') { const c = fakeContext2D(); c.canvas = this; return c; }
  return null; // no WebGL in jsdom — Phaser falls back to Canvas
};

let passed = 0, failed = 0;
const unknownCalls = new Set();

function test(name, fn) {
  let result;
  try { result = fn(); }
  catch (e) { failed++; console.log(`  ✘ ${name}\n      ${e.stack.split('\n').slice(0, 3).join('\n      ')}`); return; }

  // An async body returns a Promise, so a throw inside it never reaches the
  // catch above — the test would report PASS and the failure would escape as an
  // unhandled rejection. Refuse them outright rather than silently lying.
  if (result && typeof result.then === 'function') {
    failed++;
    console.log(`  ✘ ${name}\n      test body is async; this harness only runs synchronous tests`);
    return;
  }
  passed++;
  console.log(`  ✔ ${name}`);
}

/**
 * A permissive display-object stub. Real numeric fields so layout arithmetic
 * behaves; unknown methods return the object itself (chainable) but are
 * recorded, so a typo'd Phaser call still surfaces in the report rather than
 * passing silently.
 */
function displayObject(kind, props = {}) {
  const target = {
    __kind: kind, x: 0, y: 0, width: 100, height: 20, alpha: 1,
    scale: 1, scaleX: 1, scaleY: 1, angle: 0, visible: true, depth: 0,
    radius: 10, text: '', list: [], ...props,
  };
  const handler = {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (typeof prop !== 'string') return undefined;
      return (...args) => {
        unknownCalls.add(`${kind}.${prop}`);
        switch (prop) {
          case 'destroy': t.destroyed = true; break;
          case 'setPosition': t.x = args[0]; t.y = args[1]; break;
          case 'setRadius': t.radius = args[0]; break;
          case 'setText': t.text = String(args[0]); break;
          case 'setAlpha': t.alpha = args[0]; break;
          case 'setVisible': t.visible = args[0]; break;
          case 'setScale': t.scaleX = args[0]; t.scaleY = args[1] ?? args[0]; break;
          case 'add': t.list.push(...(Array.isArray(args[0]) ? args[0] : args)); break;
          default: break;
        }
        return receiver;
      };
    },
    set(t, prop, value) { t[prop] = value; return true; },
  };
  const receiver = new Proxy(target, handler);
  return receiver;
}

/** Fake Phaser.Scene surface: everything panels and minigames actually touch. */
function makeScene() {
  const handlers = {};
  const scene = {
    tweenCount: 0,
    delayedCalls: [],
    add: {
      text: () => displayObject('text'),
      rectangle: (x, y, w, h) => displayObject('rectangle', { x, y, width: w, height: h }),
      circle: (x, y, r) => displayObject('circle', { x, y, radius: r }),
      ellipse: (x, y, w, h) => displayObject('ellipse', { x, y, width: w, height: h }),
      triangle: () => displayObject('triangle'),
      graphics: () => displayObject('graphics'),
      container: (x = 0, y = 0) => displayObject('container', { x, y }),
    },
    tweens: {
      add: (cfg) => { scene.tweenCount++; if (cfg.onComplete) scene.delayedCalls.push(cfg.onComplete); return {}; },
      killTweensOf: () => {},
    },
    time: { delayedCall: (ms, fn) => { scene.delayedCalls.push(fn); return {}; } },
    input: {
      activePointer: { x: 400, y: 400 },
      on: (evt, fn, ctx) => { (handlers[evt] ||= []).push(fn.bind(ctx)); },
      off: () => {},
      keyboard: { on: () => {} },
    },
    cameras: { main: { shake: () => {}, setBackgroundColor: () => {} } },
    scale: { width: 1440, height: 810 },
    fire: (evt, ...args) => (handlers[evt] || []).forEach((f) => f(...args)),
    hasHandler: (evt) => (handlers[evt] || []).length > 0,
  };
  return scene;
}

const { default: Phaser } = await import('phaser');
const { TopHUD, ENEMY_STATE } = await import('../src/ui/TopHUD.js');
const { BottomHUD } = await import('../src/ui/BottomHUD.js');
const { BallHop } = await import('../src/minigames/BallHop.js');
const { VISIBLE_BEATS, JAM_REVEAL_BEATS } = await import('../src/minigames/MiniGame.js');
const { OsuCircles } = await import('../src/minigames/OsuCircles.js');
const { RunState } = await import('../src/core/RunState.js');
const { makeEnemy, enemySkillsFor } = await import('../src/data/enemies.js');
const { generateChart, LANES, TILE_KINDS } = await import('../src/core/ChartGen.js');
const { JUDGMENTS } = await import('../src/core/Judge.js');

const BOUNDS = { x: 20, y: 46, width: 380, height: 700 };

function fakeConductor(bpm = 120) {
  return {
    beat: 0, isPlaying: true, beatPhase: 0,
    msPerBeat: 60000 / bpm, secPerBeat: 60 / bpm,
  };
}

console.log('\n── phaser loads under jsdom ─────────────────────');
test('phaser imports and exposes Math helpers', () => {
  assert.strictEqual(Phaser.Math.Clamp(5, 0, 3), 3);
  assert.strictEqual(typeof Phaser.Scene, 'function');
});

console.log('\n── TopHUD ────────────────────────────────────');

test('constructs without throwing (normal enemy)', () => {
  new TopHUD(makeScene(), new RunState(1), makeEnemy(3));
});

test('constructs without throwing (boss, has crown)', () => {
  const p = new TopHUD(makeScene(), new RunState(1), makeEnemy(20));
  assert.ok(p.crown, 'boss should get a crown');
});

test('every animation state runs', () => {
  const p = new TopHUD(makeScene(), new RunState(1), makeEnemy(10));
  for (const s of Object.values(ENEMY_STATE)) p.setState(s, 100);
});

test('onBeat / update / refresh survive repeated calls', () => {
  const enemy = makeEnemy(7);
  const p = new TopHUD(makeScene(), new RunState(1), enemy);
  for (let i = 0; i < 60; i++) { p.onBeat(); p.update(); p.refresh(); }
  enemy.hp = 0;
  p.refresh();
  p.setState(ENEMY_STATE.DEATH, 500);
  p.update();
});

test('telegraph, skill label and intent render', () => {
  const p = new TopHUD(makeScene(), new RunState(1), makeEnemy(12));
  p.showTelegraph('ACCELERANDO');
  p.setSkillLabel('Shield: +40 DEF');
  p.showIntent({ name: 'Jam' });
  assert.ok(p.intentText.text.includes('JAM'), 'intent telegraph shows the skill name');
});

console.log('\n── BottomHUD ──────────────────────────────────');

test('constructs and refreshes with an empty build', () => {
  const run = new RunState(1);
  const p = new BottomHUD(makeScene(), run);
  p.refresh();
  assert.strictEqual(p.slots.length, 10, 'ten skill slots');
});

test('refreshes with a full 10-skill loadout and a pet', () => {
  const run = new RunState(1);
  ['respawn_area', 'respawn_happier', 'hurry', 'metronome_heart', 'second_wind',
   'ghost_note', 'mirror_shield', 'overclock', 'vampire_beat', 'silence']
    .forEach((id) => run.addSkill(id));
  run.pet = { id: 'cinder', level: 3 };
  run.mana = run.maxMana;
  const p = new BottomHUD(makeScene(), run);
  p.refresh();
  // The linked pair must be flagged in the UI
  const linked = p.slots.find((s) => s.skillId === 'respawn_happier');
  assert.ok(linked.label.text.includes('⛓'), 'linked skill should show the chain marker');
});

test('tooltip, flashes, beat-bop and mode switch do not throw', () => {
  const run = new RunState(1);
  run.addSkill('vampire_beat');
  const p = new BottomHUD(makeScene(), run);
  p.refresh();
  p.showTooltip(p.slots[0]);
  p.castFlash(0);
  p.flashHurt();
  p.flashHeal();
  p.setMode('enemy');
  for (let i = 0; i < 30; i++) p.onBeat();
});

test('survives low HP and zero mana states', () => {
  const run = new RunState(1);
  run.addSkill('silence');
  run.hp = 1; run.mana = 0;
  const p = new BottomHUD(makeScene(), run);
  p.refresh();
  run.hp = 0;
  p.refresh();
});

console.log('\n── minigames: full phrase playthrough ───────────');

function playPhrases(MG, level, hitRate) {
  const scene = makeScene();
  const conductor = fakeConductor(140);
  const judged = [];
  const spawned = [];
  const mg = new MG(scene, { x: 400, y: 46, width: 640, height: 700 }, conductor, {
    onJudged: (j) => judged.push(j),
    // Trap hazards are intentionally non-scoreable. Count only landing
    // targets when checking that every playable note resolves exactly once.
    onNoteSpawn: (n) => { if (n.kind !== TILE_KINDS.TRAP) spawned.push(n); },
  });
  mg.create();

  const chart = generateChart(level);
  for (const phrase of chart.phrases.slice(0, 4)) {
    mg.startPhrase(phrase);
    const end = phrase.startBeat + phrase.lengthBeats;
    // Step the clock through the phrase in quarter-beat ticks
    for (let b = phrase.startBeat - 4; b <= end + 1; b += 0.25) {
      conductor.beat = b;
      conductor.beatPhase = b - Math.floor(b);
      mg.update();
      // Simulate the player.
      //
      // hitRate must gate STEERING as well as clicking. BallHop has no click at
      // all — steering onto the tile IS the input — so an earlier version that
      // only gated clicks had the "idle" player still steering perfectly and
      // scoring 47/112. hitRate now means "intends to play this note".
      const next = mg.notes.find((n) => !n.judged && n.kind !== TILE_KINDS.TRAP);
      if (next) {
        const wantsHit = Math.random() < hitRate;
        const isSteering = typeof mg.xAt === 'function';   // BallHop
        const pairedTrap = isSteering
          ? mg.notes.find((n) => n.kind === TILE_KINDS.TRAP
            && Math.abs(n.absBeat - next.absBeat) < 1e-6)
          : null;
        const safeMissLane = pairedTrap
          ? [0, 1, 2].find((lane) => lane !== next.lane && lane !== pairedTrap.lane)
          : null;
        const targetLane = wantsHit
          ? next.lane
          : (safeMissLane ?? (next.lane + Math.ceil(LANES / 2)) % LANES);

        const px = isSteering
          ? mg.xAt(targetLane, 0)
          : (wantsHit ? (next.x ?? 500) : (next.x ?? 500) + 400);
        const py = next.y ?? mg.ballY ?? 500;

        scene.fire('pointermove', { x: px, y: py });
      }
    }
    mg.endPhrase();
  }
  mg.destroy();
  return { judged, spawned, scene };
}

test('BallHop plays four phrases and judges every note exactly once', () => {
  const { judged, spawned } = playPhrases(BallHop, 4, 0.9);
  assert.ok(spawned.length > 0, 'notes should spawn');
  assert.strictEqual(judged.length, spawned.length,
    `each of ${spawned.length} scoreable notes must be judged once, got ${judged.length}`);
});

test('OsuCircles plays four phrases and judges every note exactly once', () => {
  const { judged, spawned } = playPhrases(OsuCircles, 14, 0.9);
  assert.ok(spawned.length > 0, 'notes should spawn');
  assert.strictEqual(judged.length, spawned.length,
    `each of ${spawned.length} notes must be judged once, got ${judged.length}`);
});

test('OsuCircles uses movement only with numbered guided targets', () => {
  const scene = makeScene();
  const mg = new OsuCircles(scene, BOUNDS, fakeConductor(), {});
  mg.create();
  assert.ok(!scene.hasHandler('pointerdown'),
    'Osu mode must not bind pointerdown');
  assert.ok(scene.hasHandler('pointermove'),
    'Osu mode should read mouse movement');

  mg.startPhrase({ type: 'hero', startBeat: 0, lengthBeats: 8, notes: [
    { beat: 1, lane: 0, hold: 0 },
    { beat: 2, lane: 1, hold: 0 },
    { beat: 3, lane: 2, hold: 0 },
  ] });
  assert.strictEqual(mg.notes[0].label.text, '1');
  assert.strictEqual(mg.notes[1].label.text, '2');
  assert.strictEqual(mg.notes[2].label.text, '3');
  assert.strictEqual(mg.notes[0].obj.radius, 44,
    'Osu circles should use the enlarged target radius');
  assert.ok(mg.pathGfx, 'guided motion path graphics should exist');

  const first = mg.posFor(mg.notes[0], 0, 3);
  const again = mg.posFor(mg.notes[0], 0, 3);
  assert.deepStrictEqual(first, again, 'path positions must be deterministic');
  for (const n of mg.notes) {
    assert.ok(n.x >= BOUNDS.x + 30 && n.x <= BOUNDS.x + BOUNDS.width - 30);
    assert.ok(n.y >= BOUNDS.y + 30 && n.y <= BOUNDS.y + BOUNDS.height - 30);
  }
  const spreadX = Math.max(...mg.notes.map((n) => n.x)) - Math.min(...mg.notes.map((n) => n.x));
  const spreadY = Math.max(...mg.notes.map((n) => n.y)) - Math.min(...mg.notes.map((n) => n.y));
  assert.ok(spreadX < BOUNDS.width * 0.85, 'motion path should stay in a tighter horizontal corridor');
  assert.ok(spreadY < BOUNDS.height * 0.85, 'motion path should stay in a tighter vertical corridor');
  mg.destroy();
});

test('OsuCircles keeps motion paths inside one phrase', () => {
  const mg = new OsuCircles(makeScene(), BOUNDS, fakeConductor(), {});
  mg.create();
  const defense = {
    index: 0, type: 'enemy', startBeat: 0, lengthBeats: 8,
    notes: [
      { beat: 1, lane: 0, hold: 0 },
      { beat: 2, lane: 2, hold: 0 },
    ],
  };
  const attack = {
    index: 1, type: 'hero', startBeat: 8, lengthBeats: 8,
    notes: [
      { beat: 1, lane: 1, hold: 0 },
      { beat: 2, lane: 0, hold: 0 },
    ],
  };

  mg.startPhrase(defense);
  mg.endPhrase();
  assert.strictEqual(mg.pathAnchor, undefined,
    'a completed phrase must not leave an anchor for the next mode');

  mg.startPhrase(attack);
  assert.strictEqual(mg.notes[0].label.text, '3', 'numbering should continue across the gate');
  assert.strictEqual(mg.notes[1].label.text, '4', 'numbering should not reset on attack');
  assert.strictEqual(mg.pathSequence, 4, 'global route index should span both phrases');
  assert.strictEqual(mg.pathAnchor, undefined,
    'attack should begin without a red-to-green connector');
  mg.destroy();
});

test('OsuCircles adds sparse sliders, reverse paths, spinners, and target focus', () => {
  const conductor = fakeConductor();
  const scene = makeScene();
  const mg = new OsuCircles(scene, BOUNDS, conductor, { level: 14 });
  mg.create();
  const phrase = generateChart(14).phrases[0];
  mg.startPhrase(phrase);
  conductor.beat = phrase.startBeat;
  mg.update();

  const sliders = mg.notes.filter((n) => n.objectType === 'slider');
  const reverse = sliders.find((n) => n.reverseSlider);
  const spinner = mg.notes.find((n) => n.objectType === 'spinner');
  assert.ok(sliders.length >= 2, 'Osu should seed more than one slider in a phrase');
  assert.ok(sliders.every((n) => n.sliderTicks.length >= 4 && n.sliderPath.length === 3),
    'sliders need a curved path and tick checkpoints');
  assert.ok(sliders.every((n) => n.sliderBaseDuration >= 0.38),
    'slider travel should leave enough time to follow the path');
  assert.ok(reverse?.sliderRepeats === 2, 'one slider should reverse back along its path');
  assert.ok(spinner?.spinnerRequiredSpin > 0, 'spinner should expose a spin requirement');
  assert.ok(mg.nextTarget, 'the next visible object should be highlighted');

  mg.setHidden(conductor.beat + 4);
  mg.setFlashlight(conductor.beat + 4);
  assert.ok(mg.isHidden, 'Hidden should be active for the Osu phrase');
  assert.ok(mg.isFlashlight, 'Flashlight should be active for the Osu phrase');
  mg.destroy();
});

test('Osu enemy skills expose Hidden and Flashlight at the Osu levels', () => {
  const skills = new Set([...enemySkillsFor(13), ...enemySkillsFor(18)].map((s) => s.id));
  assert.ok(skills.has('flashlight'), 'Osu skill pool should include Flashlight');
  assert.ok(skills.has('hidden'), 'Osu skill pool should include Hidden');
});

test('a player who does nothing misses everything (and nothing crashes)', () => {
  for (const [MG, lv] of [[BallHop, 6], [OsuCircles, 16]]) {
    const { judged, spawned } = playPhrases(MG, lv, 0);
    assert.strictEqual(judged.length, spawned.length);
    const misses = judged.filter((j) => j === JUDGMENTS.MISS || j.name === 'MISS').length;
    assert.ok(misses > judged.length * 0.5,
      `${MG.name}: idle player should mostly miss, got ${misses}/${judged.length}`);
  }
});

test('speed tiers apply to both minigames', () => {
  for (const MG of [BallHop, OsuCircles]) {
    const mg = new MG(makeScene(), BOUNDS, fakeConductor(), {});
    mg.create();
    for (let t = 0; t <= 3; t++) mg.setSpeedTier(t);
    assert.strictEqual(mg.speedTier, 3);
    mg.destroy();
  }
});

console.log('\n── scene state must not leak between visits ─────');

test('every scene latch is reset in init()', () => {
  // PHASER REUSES SCENE INSTANCES across scene.start(). A flag set to true on
  // one visit is still true on the next, which is how the skill offer became
  // permanently unclickable from level 2 onward: offersResolved latched true
  // and takeSkill() returned immediately, while stat points kept working.
  //
  // This scans the source rather than the runtime, so it catches the bug in any
  // scene without needing a live Phaser game.
  const dir = new URL('../src/scenes/', import.meta.url);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));

  const problems = [];
  for (const file of files) {
    const src = fs.readFileSync(new URL(file, dir), 'utf8');

    // Body of init(), if the scene has one.
    const initMatch = src.match(/\n {2}init\s*\([^)]*\)\s*\{([\s\S]*?)\n {2}\}/);
    const initBody = initMatch ? initMatch[1] : '';

    // Fields latched to a truthy constant somewhere in the file.
    const latched = new Set();
    for (const m of src.matchAll(/this\.([A-Za-z_$][\w$]*)\s*=\s*(true|[1-9]\d*)\s*;/g)) {
      latched.add(m[1]);
    }

    for (const field of latched) {
      // Constructor-only fields are fine; we care about ones mutated in methods.
      const assignedInInit = new RegExp(`this\\.${field}\\s*=`).test(initBody);
      if (!assignedInInit && initMatch) {
        problems.push(`${file}: this.${field} latches but init() never resets it`);
      }
    }
  }

  assert.deepStrictEqual(problems, [],
    'scene state leaks across visits:\n      ' + problems.join('\n      '));
});

console.log('\n── BallHop perspective (the "road", not falling notes) ──');

test('the track is 3 lanes, and nothing hard-codes a lane count', () => {
  assert.strictEqual(LANES, 3, 'track should be 3 lanes wide');

  // Charts must never emit a lane the minigames cannot render.
  for (let lv = 1; lv <= 20; lv++) {
    for (const p of generateChart(lv).phrases) {
      for (const n of p.notes) {
        assert.ok(n.lane >= 0 && n.lane < LANES,
          `lv${lv}: lane ${n.lane} outside 0..${LANES - 1}`);
      }
    }
  }

  // Osu buckets its scatter by lane too; every bucket must be reachable.
  const mg = new OsuCircles(makeScene(), BOUNDS, fakeConductor(), {});
  mg.create();
  mg.startPhrase(generateChart(15).phrases[0]);
  for (const n of mg.notes) {
    assert.ok(n.x >= BOUNDS.x && n.x <= BOUNDS.x + BOUNDS.width,
      `osu note x ${n.x.toFixed(0)} escaped the panel`);
  }
  mg.destroy();
});

test('the road fills the panel regardless of lane count', () => {
  // Lane spacing is derived from LANES so a 3-lane track does not render as a
  // narrow ribbon with dead space either side.
  const mg = new BallHop(makeScene(), BOUNDS, fakeConductor(), {});
  mg.create();
  const left = mg.xAt(-0.62, 0);
  const right = mg.xAt(LANES - 1 + 0.62, 0);
  const frac = (right - left) / BOUNDS.width;
  assert.ok(frac > 0.65 && frac < 0.85,
    `road should span ~74% of the panel, got ${(frac * 100).toFixed(0)}%`);
  // Tiles should be chunky, as in the reference art.
  assert.ok(mg.tileW > BOUNDS.width * 0.15,
    `tiles look too thin: ${mg.tileW.toFixed(0)}px`);
  mg.destroy();
});

test('lanes converge toward a single vanishing point', () => {
  const mg = new BallHop(makeScene(), BOUNDS, fakeConductor(), {});
  mg.create();
  // Width of the whole 4-lane span must shrink as depth increases.
  const spanAt = (p) => Math.abs(mg.xAt(LANES - 1, p) - mg.xAt(0, p));
  const near = spanAt(0), mid = spanAt(0.5), far = spanAt(1);
  assert.ok(near > mid && mid > far,
    `lane span must shrink with depth (${near.toFixed(1)} > ${mid.toFixed(1)} > ${far.toFixed(1)})`);
  // Far enough away, everything collapses onto the centre line.
  assert.ok(spanAt(40) < near * 0.05, 'distant lanes should collapse to the vanishing point');
  mg.destroy();
});

test('depth maps onto the road, between horizon and ball', () => {
  const mg = new BallHop(makeScene(), BOUNDS, fakeConductor(), {});
  mg.create();
  assert.ok(mg.yAt(0) > mg.yAt(1), 'nearer tiles must sit lower on screen');
  assert.ok(Math.abs(mg.yAt(0) - mg.ballY) < 0.01, 'p=0 is the ball plane');
  assert.ok(mg.yAt(999) > mg.horizonY - 1 && mg.yAt(999) < mg.horizonY + 2,
    'infinite depth converges on the horizon');
  mg.destroy();
});

test('screen x round-trips back to the right lane', () => {
  const mg = new BallHop(makeScene(), BOUNDS, fakeConductor(), {});
  mg.create();
  for (let lane = 0; lane < LANES; lane++) {
    const back = mg.laneAtX(mg.xAt(lane, 0));
    assert.ok(Math.abs(back - lane) < 1e-6,
      `lane ${lane} should round-trip, got ${back}`);
  }
  mg.destroy();
});

test('steering the ball onto a lane scores, drifting off it misses', () => {
  const conductor = fakeConductor(120);
  const judged = [];
  const mg = new BallHop(makeScene(), BOUNDS, conductor, { onJudged: (j) => judged.push(j) });
  mg.create();

  const phrase = { type: 'hero', startBeat: 0, lengthBeats: 16, notes: [{ beat: 4, lane: LANES - 1, hold: 0 }] };
  mg.startPhrase(phrase);

  // Park the ball exactly on lane 2 and let the tile arrive.
  mg.ballX = mg.xAt(LANES - 1, 0);
  mg.targetX = mg.ballX;
  for (let b = 0; b <= 4.4; b += 0.05) { conductor.beat = b; mg.update(); }
  assert.strictEqual(judged.length, 1, 'the note should have resolved');
  assert.ok(judged[0].weight > 0, `landing on the tile should score, got ${judged[0].name}`);

  // Same note, ball parked two lanes away.
  const judged2 = [];
  const mg2 = new BallHop(makeScene(), BOUNDS, conductor, { onJudged: (j) => judged2.push(j) });
  mg2.create();
  mg2.startPhrase({ ...phrase, notes: [{ beat: 4, lane: LANES - 1, hold: 0 }] });
  mg2.ballX = mg2.xAt(0, 0);
  mg2.targetX = mg2.ballX;
  for (let b = 0; b <= 4.6; b += 0.05) { conductor.beat = b; mg2.update(); }
  assert.strictEqual(judged2.length, 1);
  assert.strictEqual(judged2[0].name, 'MISS', 'being in the wrong lane must miss');
  mg.destroy(); mg2.destroy();
});

test('parking on the tile early is a PERFECT, not a miss', () => {
  // The reported bug: sit the ball dead-centre on the lane and never move.
  // The old code resolved on the first frame of a +/-135ms window and charged
  // that 135ms as timing error, so this scored GOOD at best — and MISS if you
  // were a hair off centre. Position is the ONLY input in a steering game.
  const conductor = fakeConductor(120);
  const judged = [];
  const mg = new BallHop(makeScene(), BOUNDS, conductor, { onJudged: (j) => judged.push(j) });
  mg.create();
  mg.startPhrase({ type: 'hero', startBeat: 0, lengthBeats: 16, notes: [{ beat: 4, lane: 1, hold: 0 }] });

  mg.ballX = mg.xAt(1, 0);          // dead centre of the tile's lane
  mg.targetX = mg.ballX;
  for (let b = 0; b <= 4.3; b += 0.02) { conductor.beat = b; mg.update(); }

  assert.strictEqual(judged.length, 1);
  assert.strictEqual(judged[0].name, 'PERFECT',
    `parked dead-centre should be PERFECT, got ${judged[0].name}`);
});

test('grade degrades smoothly with distance from the tile centre', () => {
  const results = [];
  for (const offset of [0, 0.15, 0.3, 0.45, 0.8]) {
    const conductor = fakeConductor(120);
    const judged = [];
    const mg = new BallHop(makeScene(), BOUNDS, conductor, { onJudged: (j) => judged.push(j) });
    mg.create();
    mg.startPhrase({ type: 'hero', startBeat: 0, lengthBeats: 16, notes: [{ beat: 4, lane: 1, hold: 0 }] });
    mg.ballX = mg.xAt(1 + offset, 0);
    mg.targetX = mg.ballX;
    for (let b = 0; b <= 4.3; b += 0.02) { conductor.beat = b; mg.update(); }
    results.push([offset, judged[0].name, judged[0].weight]);
    mg.destroy();
  }
  // Must be monotonically non-increasing in quality as you drift off centre.
  for (let i = 0; i < results.length - 1; i++) {
    assert.ok(results[i][2] >= results[i + 1][2],
      `offset ${results[i][0]} (${results[i][1]}) should grade >= ` +
      `offset ${results[i + 1][0]} (${results[i + 1][1]})`);
  }
  assert.strictEqual(results[0][1], 'PERFECT', 'centre must be PERFECT');
  assert.strictEqual(results[4][1], 'MISS', 'well off the tile must be MISS');
});

test('the drawn tile matches the hitbox', () => {
  // If the visual and the tolerance drift apart, the game lies about its hitbox.
  const mg = new BallHop(makeScene(), BOUNDS, fakeConductor(), {});
  mg.create();
  const tolerancePx = 0.5 * mg.laneGap * 2;   // full hittable width in pixels
  assert.ok(Math.abs(mg.tileW - tolerancePx) / tolerancePx < 0.05,
    `tile width ${mg.tileW.toFixed(1)}px should match hit width ${tolerancePx.toFixed(1)}px`);
  mg.destroy();
});

test('arriving late still counts if you get there by the beat', () => {
  const conductor = fakeConductor(120);
  const judged = [];
  const mg = new BallHop(makeScene(), BOUNDS, conductor, { onJudged: (j) => judged.push(j) });
  mg.create();
  mg.startPhrase({ type: 'hero', startBeat: 0, lengthBeats: 16, notes: [{ beat: 4, lane: LANES - 1, hold: 0 }] });

  mg.ballX = mg.xAt(0, 0);
  mg.targetX = mg.ballX;
  for (let b = 0; b <= 4.3; b += 0.02) {
    conductor.beat = b;
    if (b > 3.4) mg.targetX = mg.xAt(LANES - 1, 0);   // start moving late but in time
    mg.update();
  }
  assert.strictEqual(judged.length, 1);
  assert.ok(judged[0].weight > 0,
    `a late-but-in-time arrival should score, got ${judged[0].name}`);
});

test('minigames destroy every display object they create per note', () => {
  // The neon look adds several objects per note (halo, core, ring). If any one
  // of them is not destroyed on resolve/endPhrase it leaks every single phrase,
  // and after 20 levels the scene is carrying thousands of dead objects.
  for (const MG of [BallHop, OsuCircles]) {
    const scene = makeScene();
    const mg = new MG(scene, BOUNDS, fakeConductor(), {});
    mg.create();
    const created = [];
    for (const p of generateChart(13).phrases.slice(0, 3)) {
      mg.startPhrase(p);
      for (const n of mg.notes) {
        for (const key of ['obj', 'ring', 'core', 'halo', 'tail']) {
          if (n[key]) created.push(n[key]);
        }
      }
      mg.endPhrase();
    }
    const alive = created.filter((o) => o.destroyed !== true);
    assert.strictEqual(alive.length, 0,
      `${MG.name}: ${alive.length}/${created.length} note objects were never destroyed`);
    mg.destroy();
  }
});

test('BallHop never listens for clicks', () => {
  // The whole design premise of levels 1-10 is mouse movement only.
  const scene = makeScene();
  const mg = new BallHop(scene, BOUNDS, fakeConductor(), {});
  mg.create();
  assert.ok(!scene.hasHandler('pointerdown'),
    'BallHop must not bind pointerdown — it is a steering game, not a clicking game');
  assert.ok(scene.hasHandler('pointermove'), 'it must bind pointermove');
  mg.destroy();
});

test('Trap can be skipped beside a safe tile without breaking combo', () => {
  const conductor = fakeConductor(120);
  const judged = [];
  const mg = new BallHop(makeScene(), BOUNDS, conductor, {
    onJudged: (j, n) => judged.push([j, n]),
  });
  mg.create();
  mg.startPhrase({ type: 'enemy', startBeat: 0, lengthBeats: 16,
    notes: [
      { beat: 4, lane: 1, hold: 0, kind: TILE_KINDS.NORMAL, trapPair: 'p1' },
      { beat: 4, lane: 0, hold: 0, kind: TILE_KINDS.TRAP, trapPair: 'p1' },
    ] });
  mg.ballX = mg.xAt(1, 0);
  mg.targetX = mg.ballX;
  for (let b = 0; b <= 4.2; b += 0.05) { conductor.beat = b; mg.update(); }
  assert.strictEqual(mg.trapState, null, 'safe lane should bypass the Trap');
  assert.strictEqual(mg.notes.find((n) => n.kind === TILE_KINDS.TRAP).skippedTrap, true);
  assert.strictEqual(judged.length, 1, 'only the safe tile should be judged');
  assert.strictEqual(judged[0][1].kind, TILE_KINDS.NORMAL);
  mg.endPhrase();
  assert.strictEqual(judged.length, 1, 'skipping Trap must not create a MISS');
  mg.destroy();
});

test('landing on Trap starts escape without touching combo', () => {
  const conductor = fakeConductor(120);
  const judged = [];
  const mg = new BallHop(makeScene(), BOUNDS, conductor, {
    onJudged: (j, n) => judged.push([j, n]),
  });
  mg.create();
  mg.startPhrase({ type: 'enemy', startBeat: 0, lengthBeats: 16,
    notes: [
      { beat: 4, lane: 0, hold: 0, kind: TILE_KINDS.NORMAL, trapPair: 'p2' },
      { beat: 4, lane: 1, hold: 0, kind: TILE_KINDS.TRAP, trapPair: 'p2' },
    ] });
  mg.ballX = mg.xAt(1, 0);
  mg.targetX = mg.ballX;
  for (let b = 0; b <= 4.2; b += 0.05) { conductor.beat = b; mg.update(); }
  assert.ok(mg.trapState, 'landing on Trap should enter the caught state');
  assert.ok(mg.trapMeterText.alpha > 0, 'escape meter label should be visible');

  const xs = [100, 300, 100, 300, 100, 300, 100, 300];
  xs.forEach((x) => mg.onPointerMove({ x, y: 400 }));
  conductor.beat = 4.3;
  mg.update();
  assert.strictEqual(mg.trapState, null, 'full meter should release the ball');
  assert.strictEqual(judged.length, 0, 'Trap escape must not grant or break combo');
  mg.destroy();
});

test('Boost rewards landed tiles without auto-hitting upcoming tiles', () => {
  const conductor = fakeConductor(120);
  const judged = [];
  const lenses = [];
  const mg = new BallHop(makeScene(), BOUNDS, conductor, {
    onJudged: (j, n) => judged.push([j, n]),
    onLensCollected: (amount, n) => lenses.push([amount, n]),
  });
  mg.create();
  mg.startPhrase({ type: 'hero', startBeat: 0, lengthBeats: 16, notes: [
    { beat: 4, lane: 1, hold: 0, kind: TILE_KINDS.BOOST },
    { beat: 4.5, lane: 1, hold: 0, kind: TILE_KINDS.NORMAL },
  ] });
  mg.ballX = mg.xAt(1, 0);
  mg.targetX = mg.ballX;
  for (let b = 0; b <= 4.2; b += 0.05) { conductor.beat = b; mg.update(); }
  assert.ok(mg.boostActive, 'Boost should activate on a successful landing');
  assert.strictEqual(lenses.length, 1, 'the landed Boost tile becomes one Lens');
  conductor.beat = 4.25;
  mg.update();
  assert.strictEqual(lenses.length, 1, 'an upcoming tile must not be destroyed early');
  assert.strictEqual(mg.notes.find((n) => n.beat === 4.5).judged, false);
  conductor.beat = 4.55;
  mg.update();
  assert.strictEqual(lenses.length, 2, 'a successful landed tile becomes a Lens');
  assert.strictEqual(lenses[1][1].pointFromBoost, true);
  assert.ok(judged.every(([j]) => j.weight > 0), 'Boost landings should be successful hits');
  mg.destroy();
});

console.log('\n── mode gates (the defend/attack handoff) ───────');

test('a gate fires exactly once, when the ball reaches it', () => {
  const conductor = fakeConductor(120);
  const crossed = [];
  const mg = new BallHop(makeScene(), BOUNDS, conductor, {
    onGateCrossed: (g) => crossed.push(g.type),
  });
  mg.create();
  mg.setGate({ beat: 8, type: 'enemy' });

  for (let b = 0; b < 8; b += 0.1) { conductor.beat = b; mg.update(); }
  assert.strictEqual(crossed.length, 0, 'must not fire before the ball arrives');

  for (let b = 8; b <= 12; b += 0.1) { conductor.beat = b; mg.update(); }
  assert.deepStrictEqual(crossed, ['enemy'], 'must fire once and only once');
  mg.destroy();
});

test('gates span the ENTIRE road, so they can never be dodged', () => {
  // A gate is a transition marker, not a challenge. If it were dodgeable the
  // mode could change without the player registering it.
  const mg = new BallHop(makeScene(), BOUNDS, fakeConductor(), {});
  mg.create();
  const gateL = mg.xAt(-0.62, 0);
  const gateR = mg.xAt(LANES - 1 + 0.62, 0);
  for (let lane = 0; lane < LANES; lane++) {
    const x = mg.xAt(lane, 0);
    assert.ok(x > gateL && x < gateR, `lane ${lane} sits outside the gate span`);
  }
  // Wider than any single note tile, by construction.
  assert.ok(gateR - gateL > mg.tileW * 2, 'gate must be far wider than one tile');
  mg.destroy();
});

test('BallHop keeps the runway clean: no duplicate landing rectangles or gate slabs', () => {
  const mg = new BallHop(makeScene(), BOUNDS, fakeConductor(), {});
  mg.create();

  // The road itself is the landing surface. A second rounded rectangle at the
  // ball plane reads as a duplicate tile and is especially obvious when the
  // real tile is approaching in another lane.
  let roadRectangles = 0;
  const roadSpy = new Proxy({}, {
    get(target, prop) {
      if (prop === 'strokeRoundedRect') return () => { roadRectangles++; };
      return (...args) => args;
    },
  });
  const originalRoadGfx = mg.roadGfx;
  const originalGlowPoly = mg.glowPoly;
  mg.roadGfx = roadSpy;
  mg.glowPoly = () => {};
  mg.drawRoad(0);
  mg.roadGfx = originalRoadGfx;
  mg.glowPoly = originalGlowPoly;
  assert.strictEqual(roadRectangles, 0,
    'drawRoad must not add a second rounded landing tile');

  // Guides should communicate the lane with a line only. The old aligned
  // guide drew another rectangle over the arriving slab.
  let guideRectangles = 0;
  const guideSpy = new Proxy({}, {
    get(target, prop) {
      if (prop === 'strokeRoundedRect') return () => { guideRectangles++; };
      return (...args) => args;
    },
  });
  mg.drawGuide(guideSpy, 1, 0.2, 0xffffff, true);
  assert.strictEqual(guideRectangles, 0,
    'aligned guides must not draw a duplicate rectangle');

  // Mode changes are markers, not playable tiles. A full-width slab here
  // visually combines with nearby three-lane notes into one oversized tile.
  let gateSlabs = 0;
  mg.drawSlab = () => { gateSlabs++; };
  const gateSpy = new Proxy({}, {
    get(target, prop) { return (...args) => args; },
  });
  mg.drawGate(gateSpy, { beat: 4, type: 'enemy' }, 0, mg.approachBeats(4));
  assert.strictEqual(gateSlabs, 0,
    'mode gates must not render as full-width note slabs');
  mg.destroy();
});

test('note slabs do not paint a widened shadow footprint', () => {
  const mg = new BallHop(makeScene(), BOUNDS, fakeConductor(), {});
  mg.create();

  // Isolate the footprint from the two intentional face polygons. If the
  // widened footprint exists, drawSlab calls fillPath once even when the
  // front/top face helper is stubbed out.
  let footprintFills = 0;
  const slabSpy = new Proxy({}, {
    get(target, prop) {
      if (prop === 'fillPath') return () => { footprintFills++; };
      return (...args) => args;
    },
  });
  const originalGlowPoly = mg.glowPoly;
  mg.glowPoly = () => {};
  mg.drawSlab(slabSpy, 0.25, 0.75, 0.4, 0.05, 0xff3b6b, 0xffa8c0, 1);
  mg.glowPoly = originalGlowPoly;

  assert.strictEqual(footprintFills, 0,
    'drawSlab must not paint a widened shadow/footprint behind the tile');
  mg.destroy();
});

test('BallHop enters CRUSH at 20 hits and ramps speed with the streak', () => {
  const mg = new BallHop(makeScene(), BOUNDS, fakeConductor(), {});
  mg.create();

  const normal = mg.approachBeats(4);
  const normalDepth = mg.scaleAt(1);
  const normalBallPlane = mg.yAt(0);
  mg.setCombo(19);
  assert.ok(!mg.crushActive, 'CRUSH must not start before 20 consecutive hits');
  assert.strictEqual(mg.approachBeats(4), normal, 'normal speed must stay unchanged before CRUSH');

  mg.setCombo(20);
  const crush20 = mg.approachBeats(4);
  assert.ok(mg.crushActive, '20 consecutive hits should enter CRUSH');
  assert.ok(crush20 < normal, 'CRUSH should shorten the approach window');
  assert.strictEqual(mg.crushText.text, '×20', 'only the compact multiplier should be rendered');
  assert.ok(!mg.crushText.text.includes('CRUSH'), 'the CRUSH word should not be rendered');

  assert.ok(mg.rushPerspective > 0, 'the streak should activate the racing perspective');
  assert.ok(mg.scaleAt(1) > normalDepth, 'far tiles should pull toward the camera during the rush');
  assert.ok(mg.yAt(0) > normalBallPlane, 'the racing push should move the ball plane forward');

  let slabStyle;
  let grooveLines = 0;
  const tileSpy = new Proxy({}, {
    get(target, prop) {
      if (prop === 'lineBetween') return () => { grooveLines++; };
      return (...args) => args;
    },
  });
  const originalDrawSlab = mg.drawSlab;
  mg.drawSlab = (...args) => { slabStyle = args; };
  mg.drawTile(tileSpy, 1, 0.4, 0x2bff88, 0x9dffc6, 0.9, false);
  mg.drawSlab = originalDrawSlab;
  assert.strictEqual(slabStyle[5], mg.crushColor, 'rush tiles should use the streak colour');
  assert.ok(slabStyle[8].height > 26, 'rush tiles should become visibly taller');
  assert.ok(grooveLines > 0, 'rush tiles should add speed grooves instead of a duplicate tile');

  mg.setCombo(40);
  assert.ok(mg.approachBeats(4) < crush20,
    'the approach should get faster as the CRUSH streak grows');

  mg.setCombo(0);
  assert.ok(!mg.crushActive, 'a miss/reset must leave CRUSH');
  assert.strictEqual(mg.approachBeats(4), normal, 'reset must restore normal speed');
  mg.destroy();
});

test('BallHop runway drift starts at level 5 and holds each direction for two phrases', () => {
  const phrase = { startBeat: 0, type: 'hero', notes: [] };

  const early = new BallHop(makeScene(), BOUNDS, fakeConductor(), { level: 4 });
  early.create();
  early.startPhrase(phrase);
  assert.ok(!early.viewDriftEnabled, 'level 4 must keep the runway stable');
  early.advanceViewDrift();
  assert.strictEqual(early.viewOffsetX, 0, 'disabled drift must remain centred');
  early.destroy();

  const mg = new BallHop(makeScene(), BOUNDS, fakeConductor(), { level: 5 });
  mg.create();
  mg.startPhrase(phrase);
  const firstDirection = mg.viewDriftDirection;
  const firstSegment = mg.viewDriftSegment;
  mg.startPhrase(phrase);
  assert.strictEqual(mg.viewDriftSegment, firstSegment,
    'the first drift target must last for a second phrase');
  mg.startPhrase(phrase);
  assert.strictEqual(mg.viewDriftSegment, firstSegment + 1,
    'a new drift target should begin on the third phrase');
  assert.notStrictEqual(mg.viewDriftDirection, firstDirection,
    'the runway should move to a different direction');

  mg.advanceViewDrift();
  assert.notStrictEqual(mg.viewOffsetX + mg.viewOffsetY, 0,
    'level 5 drift should ease away from the centred view');
  const point = mg.viewPoint(mg.cx + 20, mg.ballY);
  const roundTrip = mg.inverseViewPoint(point.x, point.y);
  assert.ok(Math.abs(roundTrip.x - (mg.cx + 20)) < 0.01,
    'pointer inverse must preserve lane coordinates during drift');
  mg.destroy();
});

test('mode gates do not draw a persistent three-lane tile', () => {
  const mg = new BallHop(makeScene(), BOUNDS, fakeConductor(), {});
  mg.create();

  let gateLines = 0;
  let gatePaths = 0;
  const gateSpy = new Proxy({}, {
    get(target, prop) {
      if (prop === 'lineBetween') return () => { gateLines++; };
      if (prop === 'strokePath') return () => { gatePaths++; };
      return (...args) => args;
    },
  });
  mg.drawGate(gateSpy, { beat: 4, type: 'enemy' }, 0, mg.approachBeats(4));

  assert.strictEqual(gateLines, 0,
    'a mode gate must not draw full-width rails beside a note tile');
  assert.strictEqual(gatePaths, 0,
    'a mode gate must not draw full-width chevrons that read as a tile');
  mg.destroy();
});

test('gate colour matches the mode it hands off to', () => {
  const conductor = fakeConductor(120);
  const seen = [];
  const mg = new BallHop(makeScene(), BOUNDS, conductor, {
    onGateCrossed: (g) => seen.push(g.type),
  });
  mg.create();
  for (const type of ['enemy', 'hero', 'enemy']) {
    mg.setGate({ beat: conductor.beat + 4, type });
    for (let i = 0; i <= 50; i++) { conductor.beat += 0.1; mg.update(); }
  }
  assert.deepStrictEqual(seen, ['enemy', 'hero', 'enemy']);
  mg.destroy();
});

test('gate selection walks every phrase boundary exactly once, in order', () => {
  // Replicates LevelScene.updateGate(): advance only once the current gate is
  // spent, then take the next boundary strictly ahead of the playhead.
  const chart = generateChart(6);
  const picked = [];
  let gate = null;

  for (let beat = 0; beat <= chart.totalBeats + 4; beat += 0.5) {
    if (gate && beat >= gate.beat) gate.crossed = true;
    if (!gate || gate.crossed) {
      const next = chart.phrases.find((p) => p.startBeat > beat - 0.01);
      const fresh = next ? { beat: next.startBeat, type: next.type } : null;
      if (fresh && (!gate || fresh.beat !== gate.beat)) picked.push(fresh);
      gate = fresh;
    }
  }

  assert.strictEqual(picked.length, chart.phrases.length,
    `expected one gate per phrase (${chart.phrases.length}), got ${picked.length}`);
  picked.forEach((g, i) => {
    assert.strictEqual(g.beat, chart.phrases[i].startBeat, `gate ${i} beat`);
    assert.strictEqual(g.type, i % 2 === 0 ? 'enemy' : 'hero',
      `gate ${i} should hand off to ${i % 2 === 0 ? 'enemy' : 'hero'}`);
  });
});

test('a gate is never swapped out before the ball reaches it', () => {
  // Phrase 0 starts a beat EARLY so its notes have room to approach. Indexing
  // the gate off phraseIndex therefore replaced the opening gate one beat
  // before the player crossed it, and it visibly vanished.
  const chart = generateChart(4);
  let gate = null;
  const replacedEarly = [];

  for (let beat = 0; beat <= 24; beat += 0.25) {
    const crossed = gate && beat >= gate.beat;
    if (crossed) gate.crossed = true;
    if (!gate || gate.crossed) {
      const next = chart.phrases.find((p) => p.startBeat > beat - 0.01);
      const fresh = next ? { beat: next.startBeat, type: next.type } : null;
      if (gate && !gate.crossed && fresh && fresh.beat !== gate.beat) {
        replacedEarly.push(beat);
      }
      gate = fresh;
    }
  }
  assert.deepStrictEqual(replacedEarly, [], 'gates must survive until crossed');
});

test('clearing the gate stops it drawing', () => {
  const conductor = fakeConductor(120);
  const mg = new BallHop(makeScene(), BOUNDS, conductor, {});
  mg.create();
  mg.setGate({ beat: 4, type: 'hero' });
  assert.ok(mg.gate);
  mg.setGate(null);
  assert.strictEqual(mg.gate, null);
  conductor.beat = 5;
  mg.update();     // must not throw with no gate set
  mg.destroy();
});

console.log('\n── enemy Jam and Mirror (were telegraphed, did nothing) ──');

test('Mirror flips lanes, and only for the phrase it was cast on', () => {
  for (const MG of [BallHop, OsuCircles]) {
    const mg = new MG(makeScene(), BOUNDS, fakeConductor(), {});
    mg.create();
    const phrase = generateChart(12).phrases[0];
    const original = phrase.notes.map((n) => n.lane);

    mg.setMirror(true);
    mg.startPhrase(phrase);
    const mirrored = mg.notes.map((n) => n.lane);
    assert.deepStrictEqual(mirrored, original.map((l) => (LANES - 1) - l),
      `${MG.name}: lanes should be flipped`);

    // ...and must not leak into the next phrase
    mg.endPhrase();
    mg.startPhrase(phrase);
    assert.deepStrictEqual(mg.notes.map((n) => n.lane), original,
      `${MG.name}: mirror must reset at phrase end`);
    mg.destroy();
  }
});

test('Jam shortens the sight line rather than blindfolding you', () => {
  // Jam used to hide every note outright. That is not a challenge — there is no
  // skilful response to a blindfold. It now cuts the visible road down to
  // JAM_REVEAL_BEATS, so notes still arrive readable but with far less warning.
  for (const MG of [BallHop, OsuCircles]) {
    const conductor = fakeConductor();
    const judged = [];
    const mg = new MG(makeScene(), BOUNDS, conductor, { onJudged: (j) => judged.push(j) });
    mg.create();

    const phrase = generateChart(12).phrases[0];
    mg.startPhrase(phrase);
    conductor.beat = phrase.startBeat;
    assert.strictEqual(mg.visibleBeats, VISIBLE_BEATS, `${MG.name}: normal sight line`);

    mg.setJam(phrase.startBeat + 8);
    assert.ok(mg.isJammed, `${MG.name}: should report jammed`);
    assert.strictEqual(mg.visibleBeats, JAM_REVEAL_BEATS, `${MG.name}: jammed sight line`);
    assert.ok(JAM_REVEAL_BEATS < VISIBLE_BEATS, 'jam must actually reduce visibility');
    mg.update();

    const onScreen = () => mg.notes.filter(
      (n) => n.drawn === true || n.obj?.visible === true).length;

    // Anything close by must STILL be readable, or it is a blindfold again.
    const near = mg.notes.filter((n) => {
      const d = n.absBeat - conductor.beat;
      return d >= 0 && d <= JAM_REVEAL_BEATS;
    });
    if (near.length) {
      assert.ok(onScreen() > 0, `${MG.name}: near notes must stay visible under Jam`);
    }

    // Lifting the jam must never reveal less.
    const jammedCount = onScreen();
    mg.setJam(-1);
    mg.update();
    assert.ok(onScreen() >= jammedCount, `${MG.name}: clearing Jam must not hide notes`);
    mg.setJam(phrase.startBeat + 8);

    // Notes still exist and still resolve — Jam is play-by-ear, not a stun.
    assert.ok(mg.notes.length > 0, `${MG.name}: notes must still exist`);
    const count = mg.notes.length;
    mg.endPhrase();
    assert.strictEqual(judged.length, count, `${MG.name}: jammed notes must still be judged`);
    mg.destroy();
  }
});

test('the road continues past the gate via the upcoming phrase', () => {
  // Without a preview the track visibly stops dead at every mode gate.
  const conductor = fakeConductor();
  const mg = new BallHop(makeScene(), BOUNDS, conductor, {});
  mg.create();

  const chart = generateChart(8);
  mg.startPhrase(chart.phrases[0]);
  mg.setUpcoming(chart.phrases[1]);
  assert.ok(mg.upcoming.length > 0, 'preview notes should exist');

  // Park the playhead near the end of phrase 0 so phrase 1 comes into sight.
  conductor.beat = chart.phrases[0].startBeat + chart.phrases[0].lengthBeats - 3;
  mg.update();

  assert.ok(mg.upcoming.filter((n) => n.drawn).length > 0, 'notes beyond the gate must render');
  // Preview notes belong to a phrase that is not active yet, so they must never
  // be judged — otherwise the next phrase would resolve before it began.
  assert.ok(mg.upcoming.every((n) => !n.judged), 'preview notes must not be judged');
  mg.destroy();
});

test('preview notes carry their own phrase type for colouring', () => {
  const mg = new BallHop(makeScene(), BOUNDS, fakeConductor(), {});
  mg.create();
  const chart = generateChart(8);
  mg.setUpcoming(chart.phrases[1]);
  assert.ok(mg.upcoming.length > 0);
  assert.ok(mg.upcoming.every((n) => n.phraseType === chart.phrases[1].type),
    'a red stretch beyond a red gate is the whole point');
  mg.destroy();
});

test('Jam clears at phrase end', () => {
  const conductor = fakeConductor();
  const mg = new BallHop(makeScene(), BOUNDS, conductor, {});
  mg.create();
  mg.startPhrase(generateChart(12).phrases[0]);
  mg.setJam(conductor.beat + 100);
  assert.ok(mg.isJammed);
  mg.endPhrase();
  assert.ok(!mg.isJammed, 'jam must not survive into the next phrase');
  mg.destroy();
});

console.log('\n── speed modifiers (Half Time / Tempo Thief) ────');

test('speedMultiplier lengthens approach time in both minigames', () => {
  for (const MG of [BallHop, OsuCircles]) {
    const mg = new MG(makeScene(), BOUNDS, fakeConductor(), {});
    mg.create();
    const normal = mg.approachBeats(3);
    mg.setSpeedMultiplier(1.4);           // Half Time
    const slowed = mg.approachBeats(3);
    assert.ok(slowed > normal,
      `${MG.name}: Half Time must give MORE approach time (${normal} -> ${slowed})`);
    mg.destroy();
  }
});

test('higher speed tier shortens approach time', () => {
  const mg = new BallHop(makeScene(), BOUNDS, fakeConductor(), {});
  mg.create();
  mg.setSpeedTier(1);
  const normal = mg.approachBeats(3);
  mg.setSpeedTier(3);                     // Frenzy
  assert.ok(mg.approachBeats(3) < normal, 'Frenzy must give LESS approach time');
  mg.destroy();
});

test('every level 1-20 builds a chart its minigame can start', () => {
  for (let lv = 1; lv <= 20; lv++) {
    const chart = generateChart(lv);
    const MG = chart.minigame === 'osu' ? OsuCircles : BallHop;
    const mg = new MG(makeScene(), BOUNDS, fakeConductor(), {});
    mg.create();
    for (const p of chart.phrases) { mg.startPhrase(p); mg.update(); mg.endPhrase(); }
    mg.destroy();
  }
});

console.log(`\n${'─'.repeat(50)}`);
console.log(`${passed} passed, ${failed} failed`);
if (unknownCalls.size) {
  const list = [...unknownCalls].sort();
  console.log(`\n${list.length} stubbed Phaser calls exercised (informational):`);
  console.log('  ' + list.join(', '));
}
if (failed) process.exit(1);
