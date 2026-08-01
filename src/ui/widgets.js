/**
 * widgets — DESIGN.md §5 shared components (Button / Card / Modal) plus the
 * rounded-rect drawing they all rely on.
 *
 * Everything here reads from Theme.js tokens — scenes must never hand-draw a
 * panel, stroke or button themselves. Behaviour follows §5.2 (Button states),
 * §5.1 (Card hover) and §5.11 (Modal animation).
 */
import Phaser from 'phaser';
import { COLORS, CSS, FONT } from '../core/Theme.js';

/** Fill + stroke a rounded rect centred on (0,0) of size w×h. */
export function roundRect(g, w, h, radius, fill, fillAlpha, stroke, strokeWidth) {
  if (fill !== undefined) g.fillStyle(fill, fillAlpha === undefined ? 1 : fillAlpha);
  g.fillRoundedRect(-w / 2, -h / 2, w, h, radius);
  if (stroke !== undefined) {
    g.lineStyle(strokeWidth || 1, stroke, 1);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, radius);
  }
}

/**
 * The shared menu-shell material: a shallow hexagonal panel with clipped
 * corners. It gives the non-gameplay scenes one recognisable silhouette while
 * leaving Ball Hop's road and combat HUD entirely alone.
 */
export function bevelPanel(g, w, h, {
  cut = Math.min(14, h * 0.24), fill = COLORS.card, fillAlpha = 1,
  stroke = COLORS.stroke, strokeWidth = 1, glow = 0,
} = {}) {
  const l = -w / 2, r = w / 2, t = -h / 2, b = h / 2;
  const path = () => {
    g.beginPath();
    g.moveTo(l + cut, t); g.lineTo(r - cut, t);
    g.lineTo(r, t + cut); g.lineTo(r, b - cut);
    g.lineTo(r - cut, b); g.lineTo(l + cut, b);
    g.lineTo(l, b - cut); g.lineTo(l, t + cut);
    g.closePath();
  };

  if (glow > 0) {
    g.lineStyle(strokeWidth + 8, stroke, glow * 0.10); path(); g.strokePath();
    g.lineStyle(strokeWidth + 3, stroke, glow * 0.20); path(); g.strokePath();
  }
  g.fillStyle(fill, fillAlpha); path(); g.fillPath();
  g.lineStyle(strokeWidth, stroke, 0.95); path(); g.strokePath();
}

/** Small line-art accents used by utility buttons. They stay vector-like so
 * labels remain live text while the generated atlas guides their silhouette. */
function drawButtonIcon(g, kind, x, color) {
  if (!kind) return;
  g.lineStyle(1.7, color, 1);
  if (kind === 'practice') {
    g.strokeRoundedRect(x - 8, -8, 16, 16, 8);
    g.lineBetween(x, -12, x, 12); g.lineBetween(x - 12, 0, x + 12, 0);
    g.strokeRoundedRect(x - 2, -2, 4, 4, 2);
  } else if (kind === 'unlocks') {
    g.fillStyle(color, 1); g.fillRoundedRect(x - 7, -1, 14, 10, 2);
    g.lineBetween(x - 5, -1, x - 5, -6); g.lineBetween(x - 5, -6, x + 5, -6);
    g.lineBetween(x + 5, -6, x + 5, -1);
    g.lineBetween(x, 2, x, 5);
  } else if (kind === 'audio') {
    g.fillStyle(color, 1); g.fillRect(x - 10, -4, 4, 8);
    g.lineBetween(x - 6, -4, x + 2, -10); g.lineBetween(x - 6, 4, x + 2, 10);
    g.lineBetween(x + 2, -10, x + 2, 10);
    g.lineBetween(x + 6, -6, x + 10, 0); g.lineBetween(x + 10, 0, x + 6, 6);
  }
}

/**
 * DESIGN §5.2 Button.
 *  - `color` given  -> primary style: fill 15% alpha + 2px stroke + hover glow.
 *  - `color` null   -> neutral style: `card` fill + `stroke` outline.
 * States: hover (stroke brightens, text tints), pressed (scale 0.96),
 * disabled (dimmed, unresponsive). Returns { container, setDisabled, setLabel }.
 */
export function makeButton(scene, {
  x, y, w, h = 52, label, color = null, icon = null, onClick, disabled = false, fontSize = 22,
  variant = 'auto',
}) {
  const g = scene.add.graphics();
  const t = scene.add.text(0, 0, label, {
    fontFamily: FONT.display, fontSize: `${fontSize}px`, fontStyle: 'italic', fontWeight: '700',
    color: CSS.textPrimary, align: 'center',
  }).setOrigin(0.5);
  t.setShadow(0, 2, 'rgba(0,0,0,0.7)', 3, false, true);
  const c = scene.add.container(x, y, [g, t])
    .setSize(w, h)
    .setInteractive({ useHandCursor: true });
  let isDisabled = disabled;
  const mode = variant === 'auto' ? (color ? 'primary' : 'utility') : variant;
  const accent = color || COLORS.cyan;
  const labelOffset = icon ? 12 : 0;
  t.setPosition(labelOffset, 0);
  let isPressed = false;

  const paint = (hover) => {
    g.clear();
    t.setPosition(labelOffset, isPressed ? 1 : 0);
    if (isDisabled) {
      bevelPanel(g, w, h, { fill: COLORS.panel, fillAlpha: 0.72, stroke: COLORS.stroke, glow: 0 });
      drawButtonIcon(g, icon, -w / 2 + 28, COLORS.stroke);
      t.setAlpha(0.4);
      return;
    }
    t.setAlpha(1);
    const fill = mode === 'primary' ? 0x230b2b : COLORS.panel;
    const alpha = isPressed ? 0.92 : (hover ? 0.98 : (mode === 'primary' ? 0.94 : 0.88));
    bevelPanel(g, w, h, {
      fill, fillAlpha: alpha, stroke: accent,
      strokeWidth: mode === 'primary' ? 2 : 1.5,
      glow: isPressed ? 0.65 : (hover || mode === 'primary' ? 1 : 0),
    });
    drawButtonIcon(g, icon, -w / 2 + 28, accent);
    if (hover) {
      g.fillStyle(0xffffff, 0.07);
      g.fillRect(-w / 2 + 18, -h / 2 + 4, w - 36, Math.max(3, h * 0.12));
      t.setTint(accent);
    } else t.clearTint();
  };

  c.on('pointerover', () => paint(true));
  c.on('pointerout', () => paint(false));
  c.on('pointerdown', () => {
    if (isDisabled) return;
    isPressed = true;
    paint(true);
    scene.tweens.add({
      targets: c, scale: 0.96, duration: 70, yoyo: true, ease: 'Quad.easeOut',
    });
    onClick?.();
  });
  c.on('pointerup', () => { isPressed = false; paint(false); });

  paint(false);
  if (disabled) c.disableInteractive();

  return {
    container: c,
    setDisabled(d) {
      isDisabled = d;
      if (d) c.disableInteractive(); else c.setInteractive({ useHandCursor: true });
      paint(false);
    },
    setLabel(text) { t.setText(text); },
  };
}

/**
 * DESIGN §5.1 Card. `card` fill + `stroke` outline, rounded 10.
 * Hover: stroke brightens to `strokeHi` (2px) and the card lifts 2px (120ms).
 * Returns { container, setHover } where setHover(color, width) lets callers
 * force an accent stroke (selection / danger / link states).
 */
export function makeCard(scene, { x, y, w, h, radius = 10, interactive = false }) {
  const g = scene.add.graphics();
  const c = scene.add.container(x, y, [g]).setSize(w, h);
  let hoverColor = COLORS.strokeHi;
  let lift = true;

  const paint = (hover, accent = null) => {
    g.clear();
    bevelPanel(g, w, h, {
      cut: Math.min(12, radius + 2), fill: COLORS.card, fillAlpha: 0.94,
      stroke: accent || (hover ? hoverColor : COLORS.stroke),
      strokeWidth: accent ? 2 : (hover ? 2 : 1), glow: hover || accent ? 0.65 : 0,
    });
  };
  paint(false);

  const attach = () => {
    c.on('pointerover', () => {
      paint(true);
      if (lift) scene.tweens.add({ targets: c, y: y - 2, duration: 120, ease: 'Quad.easeOut' });
    });
    c.on('pointerout', () => {
      paint(false);
      if (lift) scene.tweens.add({ targets: c, y, duration: 120, ease: 'Quad.easeOut' });
    });
  };

  if (interactive) {
    c.setInteractive({ useHandCursor: true });
    attach();
  }

  return {
    container: c,
    /** Force a specific accent stroke, e.g. cyan when selected. */
    setHover(color, width = 2) { paint(false, color); },
    /** Reset to the default stroke scheme. */
    clearAccent() { paint(false); },
    setInteractive(b) {
      if (b && !c.input) {
        c.setInteractive({ useHandCursor: true });
        attach();
      } else if (!b && c.input) c.disableInteractive();
    },
  };
}

/**
 * DESIGN §5.11 Modal. Full-screen dim (45% black) + centred `panel` card
 * (rounded 10, `stroke` outline), scale 0.96→1.0 + fade in 150ms.
 * `build(content, close)` receives the content container (origin top-left at
 * card centre minus half size) and the close function.
 */
export function openModal(scene, { w = 720, h = 520, build }) {
  const { width: W, height: H } = scene.scale;
  const layer = scene.add.container(0, 0).setDepth(600);
  const bg = scene.add.rectangle(0, 0, W, H, 0x000000, 0.45).setOrigin(0).setInteractive();
  const card = scene.add.container(W / 2, H / 2);
  const g = scene.add.graphics();
  bevelPanel(g, w, h, { cut: 18, fill: COLORS.panel, fillAlpha: 0.98, stroke: COLORS.violet, strokeWidth: 1.5, glow: 0.5 });
  card.add(g);
  const content = scene.add.container(-w / 2, -h / 2);
  card.add(content);
  layer.add([bg, card]);

  card.setScale(0.96).setAlpha(0);
  scene.tweens.add({ targets: card, scale: 1, alpha: 1, duration: 150, ease: 'Back.easeOut' });

  const close = () => {
    scene.tweens.add({
      targets: card, scale: 0.96, alpha: 0, duration: 120,
      onComplete: () => layer.destroy(true),
    });
  };
  build(content, close);
  return { layer, close };
}

/** A tiny circular accent button (used for "+" stat rows). */
export function makeCircleButton(scene, { x, y, r = 17, color = COLORS.cyan, onClick, disabled = false }) {
  const c = scene.add.circle(x, y, r, color, 0.15);
  c.setStrokeStyle(2, color, 0.9);
  c.setInteractive({ useHandCursor: true });
  const label = scene.add.text(x, y, '+', {
    fontFamily: FONT.body, fontSize: '24px', fontStyle: '700', color: CSS.textPrimary,
  }).setOrigin(0.5);

  const setDisabled = (d) => {
    if (d) {
      c.disableInteractive();
      c.setFillStyle(color, 0.05);
      c.setStrokeStyle(1, COLORS.stroke, 1);
      label.setAlpha(0.35);
    } else {
      c.setInteractive({ useHandCursor: true });
      c.setFillStyle(color, 0.15);
      c.setStrokeStyle(2, color, 0.9);
      label.setAlpha(1);
    }
  };

  c.on('pointerover', () => { c.setScale(1.12); });
  c.on('pointerout', () => { c.setScale(1); });
  c.on('pointerdown', () => {
    if (!c.input?.enabled) return;
    scene.tweens.add({ targets: c, scale: 0.9, duration: 70, yoyo: true });
    onClick?.();
  });

  setDisabled(disabled);
  return { circle: c, label, setDisabled };
}

/** Short pop animation for numbers that change (stat values, points). */
export function popText(scene, text, color) {
  scene.tweens.killTweensOf(text);
  text.setScale(1.35).setColor(color);
  scene.tweens.add({
    targets: text, scale: 1, duration: 180, ease: 'Back.easeOut',
    onComplete: () => text.setColor(CSS.textPrimary),
  });
}
