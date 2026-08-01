/**
 * SlashFX — procedural "blade sweep" slash effect (no assets).
 *
 * A bright diagonal light band sweeps across a point and fades out, like a
 * sword strike clipping the target. Drawn with pure Graphics primitives so it
 * works everywhere and matches the synthwave palette.
 *
 * Used by LevelScene: a slash pops on the enemy avatar when the player lands
 * a hit, and on the hero avatar when the enemy lands one.
 */
import Phaser from 'phaser';

/**
 * Play a slash at (x, y). Returns the container (auto-destroyed when the
 * sweep finishes).
 *
 * @param {Phaser.Scene} scene
 * @param {number} x target world x (avatar centre)
 * @param {number} y target world y (avatar centre)
 * @param {object} [opts]
 * @param {number} [opts.length=120] blade length in px
 * @param {number} [opts.color=0xffffff] main blade colour
 * @param {number} [opts.accent=0x00d4ff] glow fringe colour
 * @param {number} [opts.duration=260] total effect time in ms
 */
export function playSlash(scene, x, y, {
  length = 120,
  color = 0xffffff,
  accent = 0x00d4ff,
  duration = 260,
} = {}) {
  const c = scene.add.container(x, y);
  const g = scene.add.graphics();

  const half = length / 2;
  // bright core
  g.lineStyle(8, color, 0.95);
  g.lineBetween(-half, 0, half, 0);
  // glow fringes — thinner parallel lines offset above/below the core
  g.lineStyle(2.5, accent, 0.75);
  g.lineBetween(-half, -7, half, -7);
  g.lineBetween(-half, 7, half, 7);
  // tapered tip shimmer (short fainter core)
  g.lineStyle(3, color, 0.4);
  g.lineBetween(-half * 0.4, -13, half * 0.4, -13);
  g.lineBetween(-half * 0.4, 13, half * 0.4, 13);

  c.add(g);

  // slash direction: either diagonal, with a little angle variance
  const flip = Phaser.Math.RND.pick([1, -1]);
  c.setRotation(flip * (Math.PI / 4) + Phaser.Math.FloatBetween(-0.12, 0.12));
  c.setAlpha(0);

  // flash in + sweep outward along the blade...
  scene.tweens.add({
    targets: c,
    alpha: { from: 0, to: 1, duration: 70 },
    scaleX: { from: 0.25, to: 1.15, duration: Math.min(170, duration - 60) },
    ease: 'Quad.easeOut',
  });
  // ...then fade out and clean up
  scene.tweens.add({
    targets: c,
    alpha: 0,
    delay: Math.min(130, duration - 90),
    duration: Math.max(70, duration - 130),
    onComplete: () => c.destroy(true),
  });
  return c;
}
