import Phaser from 'phaser';
import { music } from '../core/MusicEngine.js';
import { saveManager } from '../core/SaveManager.js';
import { COLORS, CSS, FONT } from '../core/Theme.js';
import { ASSETS, ANIM_SHEETS, hasTexture } from '../core/Assets.js';
import { createSheetAnims, enemyAnimPrefix, inferSheetFrameSize } from '../core/Anims.js';
import { registerBgm, playMenuBgm } from '../core/Bgm.js';
import { drawBackdrop } from '../ui/backdrop.js';
import { makeButton } from '../ui/widgets.js';

/**
 * BootScene — the click gate.
 * Browsers start every AudioContext suspended and will not let it resume without
 * a genuine user gesture. This scene exists purely so that gesture happens before
 * anything time-critical, which is why "Start" is a button and not an auto-advance.
 *
 * DESIGN §7: the logo is a cyan→magenta neon-tube gradient, drawn onto a canvas
 * texture (Monoton, preloaded via index.html @font-face). If the user provides
 * public/assets/ui/logo.png (see ASSETS.md), it replaces the procedural logo.
 */
export class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }

  preload() {
    // ASSETS.md: register every possible asset; missing files are skipped
    // silently (loaderror collected, game continues with procedural fallbacks).
    this.load.on('loaderror', (file) => {
      console.info(`[assets] missing, using procedural fallback: ${file.key}`);
    });
    ASSETS.forEach((a) => this.load.image(a.key, a.path));
    // ASSETS.md §6: optional sprite-sheet animations. Loaded as plain images
    // first; the actual grid (frame size + row count) is detected in create()
    // from the file dimensions — any square-frame grid works, not just the
    // reference 320×400 5×4 layout.
    ANIM_SHEETS.forEach((a) => this.load.image(`${a.key}_raw`, a.path));
    // Menu BGM tracks (Kevin MacLeod, CC BY 4.0 — see Bgm.js).
    registerBgm(this);
  }

  async create() {
    // Register state animations for every sheet that actually loaded and
    // looks like a 4-column square-frame grid.
    ANIM_SHEETS.forEach((a) => {
      const rawKey = `${a.key}_raw`;
      if (!hasTexture(this, rawKey)) return; // file missing → procedural fallback
      const img = this.textures.get(rawKey).source[0].image;
      const grid = inferSheetFrameSize(img.width, img.height);
      if (!grid) {
        console.warn(`[assets] ${a.key} (${img.width}x${img.height}) does not look like a 4-column square-frame grid; using procedural fallback`);
        return;
      }
      // Re-slice the loaded image into a proper spritesheet texture.
      this.textures.addSpriteSheet(a.key, img, {
        frameWidth: grid.frameWidth,
        frameHeight: grid.frameHeight,
      });
      const prefix = a.key === 'hero_anim'
        ? 'hanim'
        : enemyAnimPrefix(Number(a.key.replace('enemy_anim_', '')));
      createSheetAnims(this, a.key, prefix, grid);
    });

    const { width: W, height: H } = this.scale;
    this.cameras.main.setBackgroundColor(CSS.bg);
    drawBackdrop(this);

    // DESIGN §7: gradient neon-tube logo (or user-provided asset).
    // The user's logo is a wide banner (1064×143 after cropping); it is sized
    // to ~92% of the canvas width — the old 76px height ×5 would be 2828px
    // wide and overflow the screen.
    let logo;
    if (hasTexture(this, 'logo')) {
      logo = this.add.image(W / 2, 190, 'logo');
      logo.setScale((W * 0.92) / logo.width);
    } else {
      logo = await this.gradientLogo(W / 2, 190);
    }
    if (logo) this.tweens.add({ targets: logo, y: logo.y - 8, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    this.add.text(W / 2, 330,
      'The enemy sets the tempo. You answer with your mouse.', {
      fontFamily: FONT.body, fontSize: '19px', color: CSS.textDim,
    }).setOrigin(0.5);

    // Same runway CTA used by the menu, so the first click already establishes
    // the non-gameplay interaction language.
    makeButton(this, {
      x: W / 2, y: H / 2 + 52, w: 300, h: 56,
      label: 'ENTER THE RUNWAY', color: COLORS.magenta, fontSize: 18, variant: 'primary',
      onClick: async () => {
        await music.init();
        music.setMusicVolume(saveManager.settings.musicVol);
        music.setSfxVolume(saveManager.settings.sfxVol);
        music.sfx('ui');
        // Start the menu BGM the moment the click unlocks audio — the player
        // should never hear a silent Boot -> Menu transition. Autoplay policy
        // forbids any sound BEFORE this click, so this is the earliest legal
        // point. MenuScene keeps the same track playing (playMenuBgm no-ops
        // when a track is already running).
        playMenuBgm(this);
        this.scene.start('Menu');
      },
    });

    this.add.text(W / 2, H - 40,
      'Audio is generated live in your browser — nothing to download, always in sync.', {
      fontFamily: FONT.body, fontSize: '14px', color: CSS.textFaint,
    }).setOrigin(0.5);
  }

  /**
   * Renders "RYTHMIC" with a horizontal cyan→magenta gradient + neon glow onto
   * a canvas texture. Falls back to a plain text object if canvas/fonts are
   * unavailable (it must never throw — Boot is the very first thing players see).
   */
  async gradientLogo(x, y) {
    try {
      await document.fonts.load('76px Monoton');
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 170;
      const ctx = canvas.getContext('2d');
      ctx.font = '76px Monoton, "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
      grad.addColorStop(0, CSS.cyan);
      grad.addColorStop(1, CSS.magenta);
      ctx.shadowColor = 'rgba(0, 212, 255, 0.85)';
      ctx.shadowBlur = 26;
      ctx.fillStyle = grad;
      ctx.fillText('RYTHMIC', canvas.width / 2, canvas.height / 2);
      this.textures.addCanvas('logo-gradient', canvas);
      return this.add.image(x, y, 'logo-gradient');
    } catch {
      const t = this.add.text(x, y, 'RYTHMIC', {
        fontFamily: FONT.logo, fontSize: '76px', color: CSS.cyan,
      }).setOrigin(0.5);
      t.setShadow(0, 0, CSS.cyan, 18, true, false);
      this.tweens.add({ targets: t, y: y - 8, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      return null;
    }
  }
}
