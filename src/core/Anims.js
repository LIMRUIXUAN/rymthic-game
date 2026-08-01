/**
 * Anims — sprite-sheet animation definitions (ASSETS.md §6).
 *
 * Sheet grid convention: ANIM_COLS columns of square frames, rows top→bottom:
 *   row 0 idle · row 1 attack · row 2 hurt · row 3 cast · row 4 death
 * Any square-frame grid is accepted: the frame size is detected from the
 * actual image dimensions (see inferSheetFrameSize), so sheets no longer have
 * to be exactly 320×400. Extra rows past death (e.g. a 6th victory row) are
 * simply ignored; missing rows mean those states keep the procedural fallback.
 * Sheets are optional: missing sheets never register anims, and the HUDs keep
 * their procedural animations (see TopHUD/BottomHUD fallbacks).
 */
import { hasTexture } from './Assets.js';

export const ANIM_STATES = ['idle', 'attack', 'hurt', 'cast', 'death'];
export const ANIM_COLS = 4;

const FRAME_RATE = { idle: 8, attack: 14, hurt: 14, cast: 12, death: 12 };

/**
 * Detect the frame grid of a raw sprite sheet (loaded as a plain image).
 *
 * Convention: ANIM_COLS columns; frames are (near-)square, so the frame size
 * follows from the width and the row count from the height. Returns
 * `{ frameWidth, frameHeight, rows }`, or null when the image does not look
 * like a 4-column square-frame grid (caller keeps the procedural fallback).
 *
 *  320×400   → frameWidth 80,  rows 5   (the ASSETS.md reference layout)
 *  1024×1536 → frameWidth 256, rows 6   (AI-generated 4×6 grid)
 */
export function inferSheetFrameSize(width, height) {
  if (!width || !height || width % ANIM_COLS !== 0) return null;
  const frameWidth = width / ANIM_COLS;
  const rows = Math.round(height / frameWidth);
  if (rows < 1) return null;
  const frameHeight = height / rows;
  // Reject irregular grids (non-square frames) — they would misalign the rows.
  if (Math.abs(frameHeight - frameWidth) > frameWidth * 0.15) return null;
  return {
    frameWidth,
    frameHeight: Math.floor(frameHeight),
    rows,
  };
}

/**
 * Register the state animations for one sprite-sheet texture.
 * `prefix` namespaces the anim keys (e.g. 'hanim', 'eanim_3').
 * Rows are consumed in order from ANIM_STATES: a sheet with fewer rows simply
 * registers fewer states; a sheet with more rows ignores the extras.
 * Returns true when at least one anim was (re)created.
 */
export function createSheetAnims(scene, texKey, prefix) {
  if (!hasTexture(scene, texKey)) return false;
  const tex = scene.textures.get(texKey);
  // getFrameNames() excludes '__BASE' by default, so this is the frame count
  const totalFrames = tex.getFrameNames().length;
  const rows = Math.floor(totalFrames / ANIM_COLS);
  if (rows < 1) return false;

  let created = 0;
  ANIM_STATES.slice(0, rows).forEach((state, row) => {
    const key = `${prefix}_${state}`;
    if (scene.anims.exists(key)) return; // anims are game-global; create once
    const start = row * ANIM_COLS;
    const frames = scene.anims.generateFrameNumbers(texKey, {
      start,
      end: start + ANIM_COLS - 1,
    });
    if (!frames.length) return;
    scene.anims.create({
      key,
      frames,
      frameRate: FRAME_RATE[state],
      repeat: state === 'idle' ? -1 : 0,
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
