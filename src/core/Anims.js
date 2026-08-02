/**
 * Anims — sprite-sheet animation definitions (ASSETS.md §6).
 *
 * New sheets use eight columns and ten rows, in this fixed order:
 * idle, windup, attack, hurt, defense, cast, stun, victory, death, phase_change.
 * Existing four-column sheets are still accepted with their original five
 * states so the art migration can happen incrementally.
 */
import { hasTexture } from './Assets.js';

export const ANIM_STATES = [
  'idle', 'windup', 'attack', 'hurt', 'defense',
  'cast', 'stun', 'victory', 'death', 'phase_change',
];
export const LEGACY_ANIM_STATES = ['idle', 'attack', 'hurt', 'cast', 'death'];
export const ANIM_COLS = 8;
export const LEGACY_ANIM_COLS = 4;

export const ANIM_TIMING = {
  idle: { frameRate: 8, loop: true },
  windup: { frameRate: 10, loop: false },
  attack: { frameRate: 16, loop: false },
  hurt: { frameRate: 10, loop: false },
  defense: { frameRate: 8, loop: true },
  cast: { frameRate: 10, loop: false },
  stun: { frameRate: 10, loop: false },
  victory: { frameRate: 8, loop: false, hold: true },
  death: { frameRate: 10, loop: false, hold: true },
  phase_change: { frameRate: 8, loop: false, hold: true },
};

export const ANIM_DURATIONS = {
  idle: Infinity,
  windup: 800,
  attack: 500,
  hurt: 800,
  defense: Infinity,
  cast: 800,
  stun: 800,
  victory: 1000,
  death: 800,
  phase_change: 1000,
};

/**
 * Detect a square-frame grid. When the column count is omitted, prefer the
 * new 8×10 contract but recognize the existing 4×5/4×6 legacy sheets too.
 */
export function inferSheetFrameSize(width, height, columns = null) {
  if (!width || !height) return null;

  const candidates = columns ? [columns] : [ANIM_COLS, LEGACY_ANIM_COLS];
  const valid = candidates.map((cols) => {
    if (width % cols !== 0) return null;
    const frameWidth = width / cols;
    const rows = Math.round(height / frameWidth);
    if (rows < 1) return null;
    const frameHeight = height / rows;
    if (Math.abs(frameHeight - frameWidth) > frameWidth * 0.15) return null;
    return { frameWidth, frameHeight: Math.floor(frameHeight), rows, cols };
  }).filter(Boolean);

  if (!valid.length) return null;
  return valid.sort((a, b) => {
    const aExact = a.rows === (a.cols === ANIM_COLS ? ANIM_STATES.length : LEGACY_ANIM_STATES.length);
    const bExact = b.rows === (b.cols === ANIM_COLS ? ANIM_STATES.length : LEGACY_ANIM_STATES.length);
    // 320×400 is the original documented 4×5 reference sheet. Both 4×5 and
    // 8×10 mathematically fit that aspect ratio, so use the sheet's scale to
    // disambiguate the old small reference from the new 256px contract.
    if (aExact && bExact) return width >= 1536 ? (a.cols === ANIM_COLS ? -1 : 1) : (a.cols === LEGACY_ANIM_COLS ? -1 : 1);
    if (aExact !== bExact) return aExact ? -1 : 1;
    const aTarget = a.cols === ANIM_COLS ? ANIM_STATES.length : LEGACY_ANIM_STATES.length;
    const bTarget = b.cols === ANIM_COLS ? ANIM_STATES.length : LEGACY_ANIM_STATES.length;
    return Math.abs(a.rows - aTarget) - Math.abs(b.rows - bTarget);
  })[0];
}

/** Register all states available in one sheet. */
export function createSheetAnims(scene, texKey, prefix, grid = null) {
  if (!hasTexture(scene, texKey)) return false;
  const tex = scene.textures.get(texKey);
  const cols = grid?.cols || ANIM_COLS;
  const states = cols === LEGACY_ANIM_COLS ? LEGACY_ANIM_STATES : ANIM_STATES;
  const totalFrames = tex.getFrameNames().length;
  const rows = Math.floor(totalFrames / cols);
  if (rows < 1) return false;

  let created = 0;
  states.slice(0, rows).forEach((state, row) => {
    const key = `${prefix}_${state}`;
    if (scene.anims.exists(key)) return;
    const start = row * cols;
    const frames = scene.anims.generateFrameNumbers(texKey, {
      start,
      end: start + cols - 1,
    });
    if (!frames.length) return;
    const timing = ANIM_TIMING[state] || { frameRate: 10, loop: false };
    scene.anims.create({
      key,
      frames,
      frameRate: timing.frameRate,
      repeat: timing.loop ? -1 : 0,
    });
    created++;
  });
  return created > 0;
}

/** Enemy sheet keys follow the level (ASSETS.md: enemy_anim_<n>.png). */
export const enemyAnimTexKey = (level) => `enemy_anim_${level}`;
export const hasEnemyAnim = (scene, level) => hasTexture(scene, enemyAnimTexKey(level));
export const enemyAnimPrefix = (level) => `eanim_${level}`;
export const hasHeroAnim = (scene) => hasTexture(scene, 'hero_anim');
