import assert from 'node:assert/strict';
import {
  ANIM_COLS,
  ANIM_DURATIONS,
  ANIM_STATES,
  ANIM_TIMING,
  LEGACY_ANIM_COLS,
  createSheetAnims,
  inferSheetFrameSize,
} from '../src/core/Anims.js';

const grid = inferSheetFrameSize(2048, 2560);
assert.deepEqual(grid, { frameWidth: 256, frameHeight: 256, rows: 10, cols: 8 });
assert.equal(ANIM_COLS, 8);
assert.equal(ANIM_STATES.length, 10);
assert.equal(ANIM_DURATIONS.hurt, 800);
assert.equal(ANIM_TIMING.hurt.frameRate, 10);

const legacy = inferSheetFrameSize(1024, 1536);
assert.equal(legacy.cols, LEGACY_ANIM_COLS);
assert.equal(legacy.rows, 6);
assert.equal(inferSheetFrameSize(320, 400).cols, LEGACY_ANIM_COLS);

const created = [];
const scene = {
  textures: {
    exists: () => true,
    get: () => ({ getFrameNames: () => Array.from({ length: 80 }, (_, i) => String(i)) }),
  },
  anims: {
    exists: () => false,
    generateFrameNumbers: (_key, range) => Array.from(
      { length: range.end - range.start + 1 },
      (_, i) => ({ index: range.start + i }),
    ),
    create: (config) => created.push(config),
  },
};

assert.equal(createSheetAnims(scene, 'enemy_anim_1', 'eanim_1', grid), true);
assert.equal(created.length, 10);
assert.ok(created.every((animation) => animation.frames.length === 8));
assert.equal(created[0].key, 'eanim_1_idle');
assert.equal(created[3].key, 'eanim_1_hurt');
assert.equal(created[3].frameRate, 10);
assert.equal(created[0].repeat, -1);
assert.equal(created[8].repeat, 0);

const legacyCreated = [];
const legacyScene = {
  ...scene,
  textures: {
    exists: () => true,
    get: () => ({ getFrameNames: () => Array.from({ length: 24 }, (_, i) => String(i)) }),
  },
  anims: { ...scene.anims, create: (config) => legacyCreated.push(config) },
};
createSheetAnims(legacyScene, 'legacy', 'eanim_legacy', legacy);
assert.deepEqual(legacyCreated.map((animation) => animation.key), [
  'eanim_legacy_idle', 'eanim_legacy_attack', 'eanim_legacy_hurt',
  'eanim_legacy_cast', 'eanim_legacy_death',
]);

console.log('Animation contract tests passed');
