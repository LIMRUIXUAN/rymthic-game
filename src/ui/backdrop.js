/**
 * backdrop — DESIGN.md §7: a shared programmatic synthwave backdrop for the
 * menu-style scenes (Boot / Menu / Upgrade / GameOver).
 *
 * Sky gradient rising to a purple horizon, a wireframe grid converging on the
 * horizon line, and faint scanlines over everything. Pure primitives — no
 * assets, consistent with the rest of the game.
 */
import Phaser from 'phaser';
import { COLORS } from '../core/Theme.js';

export function drawBackdrop(scene, { horizonRatio = 0.32, accent = COLORS.cyan } = {}) {
  const { width: W, height: H } = scene.scale;

  // ASSETS.md P3: a user-provided full-screen background replaces the whole
  // procedural backdrop (sky + grid + scanlines).
  if (scene.textures.exists('bg_menu')) {
    scene.add.image(0, 0, 'bg_menu').setOrigin(0).setDisplaySize(W, H).setDepth(-100);
    return null;
  }

  const g = scene.add.graphics().setDepth(-100);
  const hY = H * horizonRatio;

  // sky: banded gradient, near-black at the top -> deep purple at the horizon
  const top = { r: 0x07, g: 0x07, b: 0x0d };
  const bot = { r: 0x2b, g: 0x0a, b: 0x4d };
  const bands = 20;
  for (let i = 0; i < bands; i++) {
    const t = i / bands;
    const r = Math.round(top.r + (bot.r - top.r) * t);
    const gg = Math.round(top.g + (bot.g - top.g) * t);
    const b = Math.round(top.b + (bot.b - top.b) * t);
    g.fillStyle(Phaser.Display.Color.GetColor(r, gg, b), 1);
    g.fillRect(0, Math.floor(hY * t), W, Math.ceil(hY / bands) + 1);
  }

  // ground
  g.fillStyle(0x03030a, 1);
  g.fillRect(0, hY, W, H - hY);

  // horizon line
  g.lineStyle(2, accent, 0.85);
  g.lineBetween(0, hY, W, hY);

  // converging grid on the ground
  g.lineStyle(1, accent, 0.16);
  const cx = W / 2;
  for (let i = -9; i <= 9; i++) {
    g.lineBetween(cx + i * 110, hY, cx + i * 300, H);
  }
  for (let k = 1; k <= 8; k++) {
    const y = hY + (H - hY) * (k / 8) ** 2;
    g.lineBetween(0, y, W, y);
  }

  // scanlines — CRT texture over everything
  g.fillStyle(0x000000, 0.16);
  for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);

  return g;
}
