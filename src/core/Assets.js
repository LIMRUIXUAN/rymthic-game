/**
 * Assets — the single asset manifest + graceful-fallback helpers.
 *
 * Spec: ASSETS.md. Files live in public/assets/ and are registered in
 * BootScene.preload. Anything missing is silently skipped (loaderror is
 * collected, never fatal). Every consumer checks `hasTexture()` first and
 * falls back to the procedural primitive it replaces, so the game is fully
 * playable with zero assets.
 */
import { SKILLS } from '../data/skills.js';
import { PETS } from '../data/pets.js';

const ENEMY_SKILL_IDS = ['jam', 'mirror', 'accelerando', 'shield', 'mend', 'curse'];
const ENEMY_COUNT = 20;

export const ASSETS = [
  { key: 'logo', path: '/assets/ui/logo.png' },
  { key: 'hero_avatar', path: '/assets/hero/avatar.png' },
  { key: 'bg_menu', path: '/assets/ui/bg_menu.png' },
  { key: 'btn_9slice', path: '/assets/ui/button.png' },
  { key: 'btn_9slice_pressed', path: '/assets/ui/button_pressed.png' },
  ...ENEMY_SKILL_IDS.map((id) => ({ key: `eskill_${id}`, path: `/assets/ui/eskill_${id}.png` })),
  // e00.png is an optional generic filler used when the level-specific art is missing
  { key: 'enemy_0', path: '/assets/enemies/e00.png' },
  ...Array.from({ length: ENEMY_COUNT }, (_, i) => ({
    key: `enemy_${i + 1}`,
    path: `/assets/enemies/e${String(i + 1).padStart(2, '0')}.png`,
  })),
  ...SKILLS.map((s) => ({ key: `skill_${s.id}`, path: `/assets/skills/skill_${s.id}.png` })),
  ...PETS.map((p) => ({ key: `pet_${p.id}`, path: `/assets/pets/pet_${p.id}.png` })),
];

/**
 * Optional sprite-sheet animations (ASSETS.md §6): hero + one sheet per enemy
 * level. Any 4-column grid of square frames is accepted — BootScene loads the
 * raw image, detects the frame size, and slices it into a spritesheet
 * (see Anims.inferSheetFrameSize). The reference layout is 5 rows × 4 cols of
 * 80×80 frames (320×400); extra rows past death are ignored.
 */
export const ANIM_SHEETS = [
  { key: 'hero_anim', path: '/assets/hero/anim.png' },
  ...Array.from({ length: ENEMY_COUNT }, (_, i) => ({
    key: `enemy_anim_${i + 1}`,
    path: `/assets/enemies/enemy_anim_${String(i + 1).padStart(2, '0')}.png`,
  })),
];

/** True when the texture for this key actually loaded (i.e. the user provided it). */
export const hasTexture = (scene, key) => !!scene.textures?.exists?.(key);

/**
 * Best available enemy-avatar key for a level: level-specific art, else the
 * generic e00 filler, else null (caller keeps the procedural drawing).
 */
export function enemyTexKey(scene, level) {
  if (hasTexture(scene, `enemy_${level}`)) return `enemy_${level}`;
  if (hasTexture(scene, 'enemy_0')) return 'enemy_0';
  return null;
}
