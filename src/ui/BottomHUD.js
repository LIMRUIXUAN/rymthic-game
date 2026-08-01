/**
 * BottomHUD — DESIGN.md §2: the bottom bar.
 *
 * Layout (1440×160):
 *   [enemy mini]                ◉ beat pulse        [hero avatar + HP/MP]
 *   avatar + HP bar                                 [skill bar 2×5]
 *
 * Left: a compact enemy zone (avatar + HP bar) mirroring the top HUD.
 * Right, above the skill bar: the hero avatar with larger HP/MP bars.
 * Skill casting: click a slot or press 1-9,0.
 *
 * Everything here reads from Theme.js / Layout.js — no hardcoded colours.
 */
import Phaser from 'phaser';
import { COLORS, CSS, FONT } from '../core/Theme.js';
import { CANVAS_H, BOTTOM_HUD_H, HUD_PAD, SKILL_SLOT, SKILL_GAP } from '../core/Layout.js';
import { SKILL_BY_ID, SKILL_TYPE } from '../data/skills.js';
import { PET_BY_ID } from '../data/pets.js';
import { hasTexture } from '../core/Assets.js';
import { hasHeroAnim } from '../core/Anims.js';

export class BottomHUD {
  constructor(scene, run) {
    this.scene = scene;
    this.run = run;
    this.slots = [];
    this.onCast = null;
    this.build();
  }

  build() {
    const s = this.scene;
    const W = s.scale.width;
    const barH = BOTTOM_HUD_H;
    // The bottom bar occupies the last BOTTOM_HUD_H pixels of the canvas.
    // All child coordinates below are relative to the bar and shifted by
    // BAR_Y — missing this offset used to render the whole HUD at the top
    // of the screen, covering TopHUD.
    const BAR_Y = CANVAS_H - barH;

    const bg = s.add.graphics();
    bg.fillStyle(COLORS.panel, 1);
    bg.fillRect(0, BAR_Y, W, barH);
    bg.lineStyle(1, COLORS.stroke, 1);
    bg.lineBetween(0, BAR_Y, W, BAR_Y);

    // ---- right: skill bar (2 rows × 5 cols) sits at the bottom edge ----
    const cols = 5;
    const rows = 2;
    const slot = SKILL_SLOT;
    const gap = SKILL_GAP;
    const barW2 = cols * slot + (cols - 1) * gap;   // 244
    const barH2 = rows * slot + (rows - 1) * gap;   // 94
    const bx = W - HUD_PAD - barW2;
    const by = BAR_Y + (barH - 8 - barH2);

    // ---- right: hero zone above the skill bar ----
    const av = 88;                 // 2× bigger hero avatar
    const hpW = 220, hpH = 16;     // bigger HP bar
    const mpW = 220, mpH = 12;     // bigger MP bar
    const heroY = BAR_Y + (barH - 8 - barH2) / 2; // vertical centre above the bar
    // Hero row is wider than the skill bar; right-align its bars with the
    // skill bar's right edge so nothing runs off screen.
    const heroRight = bx + barW2;  // skill bar right edge (1428)
    this.avatarX = heroRight - av - 10 - hpW + av / 2;
    this.avatarY = heroY;

    this.avatar = s.add.container(this.avatarX, this.avatarY);
    // ASSETS.md §6: hero sprite-sheet animation (idle loop; attack/hurt on demand)
    this.animSprite = null;
    this.avatarImg = null;
    this.avatarBody = null;
    if (hasHeroAnim(s)) {
      this.animSprite = s.add.sprite(0, 0, 'hero_anim').setDisplaySize(av * 1.2, av * 1.2);
      this.animSprite.play('hanim_idle');
      this.avatar.add(this.animSprite);
    } else if (hasTexture(s, 'hero_avatar')) {
      this.avatarImg = s.add.image(0, 0, 'hero_avatar').setDisplaySize(av, av);
      this.avatar.add(this.avatarImg);
    } else {
      this.avatarBody = s.add.rectangle(0, 0, av, av * 1.2, COLORS.cyan);
      this.avatarBody.setStrokeStyle(2, 0xffffff, 0.3);
      const eL = s.add.circle(-8, -8, 4, COLORS.panel);
      const eR = s.add.circle(8, -8, 4, COLORS.panel);
      this.avatar.add([this.avatarBody, eL, eR]);
    }

    const hx = this.avatarX + av / 2 + 10;
    this.barX = hx;
    this.hpBg = s.add.rectangle(hx, heroY - 9, hpW, hpH, 0x1a1a2c).setOrigin(0, 0.5);
    this.hpBg.setStrokeStyle(1, COLORS.strokeHi);
    this.hpFill = s.add.rectangle(hx + 1, heroY - 9, hpW - 2, hpH - 2, COLORS.hero).setOrigin(0, 0.5);
    this.mpBg = s.add.rectangle(hx, heroY + 8, mpW, mpH, 0x1a1a2c).setOrigin(0, 0.5);
    this.mpBg.setStrokeStyle(1, COLORS.strokeHi);
    this.mpFill = s.add.rectangle(hx + 1, heroY + 8, mpW - 2, mpH - 2, COLORS.cyan).setOrigin(0, 0.5);

    // pet dot next to avatar (procedural circle, or pet art when provided)
    this.petDot = s.add.circle(this.avatarX + av / 2 + 6, this.avatarY + av / 2 + 6, 7, 0x555577, 1).setVisible(false);
    this.petImg = null;

    // ---- center: beat pulse + time ----
    const cx = W / 2;
    this.beatDot = s.add.circle(cx, BAR_Y + barH / 2 - 6, 12, COLORS.hero, 0.22);
    this.beatDot.setStrokeStyle(2, COLORS.hero, 0.9);
    // Lens are run loot created by successful Boost landings. Keep the counter beside
    // the beat pulse so the player can read the reward without covering the
    // runway or the skill slots.
    this.lensText = s.add.text(cx + 32, BAR_Y + barH / 2 - 6, '◈ 0', {
      fontFamily: FONT.display, fontSize: '13px', fontStyle: '700', color: CSS.amber,
    }).setOrigin(0, 0.5);
    this.timeText = s.add.text(cx, BAR_Y + barH - 9, '', {
      fontFamily: FONT.body, fontSize: '12px', color: CSS.textDim,
    }).setOrigin(0.5, 0);
    this.escText = s.add.text(cx - 240, BAR_Y + barH - 9, 'ESC — abandon run', {
      fontFamily: FONT.body, fontSize: '12px', color: CSS.textFaint,
    }).setOrigin(0.5, 0);

    this.buildSlots(bx, by, slot, gap, cols);

    this.tooltip = s.add.text(0, 0, '', {
      fontFamily: FONT.body, fontSize: '13px', color: CSS.textPrimary,
      backgroundColor: '#12121f', padding: { x: 8, y: 6 },
      wordWrap: { width: 220 },
    }).setDepth(1000).setVisible(false);
  }

  buildSlots(bx, by, slot, gap, cols) {
    const s = this.scene;
    this.slots.forEach((sl) => sl.container.destroy(true));
    this.slots = [];

    for (let i = 0; i < 10; i++) {
      const col = i % cols, row = Math.floor(i / cols);
      const x = bx + col * (slot + gap) + slot / 2;
      const y = by + row * (slot + gap) + slot / 2;

      const container = s.add.container(x, y);
      const box = s.add.rectangle(0, 0, slot, slot, 0x141424, 1);
      box.setStrokeStyle(1, 0x2a2a44);
      const key = s.add.text(-slot / 2 + 4, -slot / 2 + 3, `${(i + 1) % 10}`, {
        fontFamily: FONT.body, fontSize: '11px', fontStyle: '600', color: '#44446a',
      }).setOrigin(0, 0);
      const label = s.add.text(0, -2, '—', {
        fontFamily: FONT.body, fontSize: '11px', fontStyle: '600', color: '#33334f',
      }).setOrigin(0.5);
      const cost = s.add.text(slot / 2 - 4, slot / 2 - 6, '', {
        fontFamily: FONT.body, fontSize: '11px', fontStyle: '600', color: CSS.cyan,
      }).setOrigin(1, 1);

      container.add([box, key, label, cost]);
      box.setInteractive({ useHandCursor: true });

      const slotObj = { container, box, label, cost, key, index: i, skillId: null, w: slot, h: slot };
      box.on('pointerover', () => this.showTooltip(slotObj));
      box.on('pointerout', () => this.tooltip.setVisible(false));
      box.on('pointerdown', () => { if (slotObj.skillId) this.onCast?.(slotObj.skillId); });
      this.slots.push(slotObj);
    }
  }

  showTooltip(slot) {
    if (!slot.skillId) return;
    const sk = SKILL_BY_ID[slot.skillId];
    if (!sk) return;
    const linked = sk.linksWith && this.run.hasSkill(sk.linksWith);
    const txt = `${sk.name}${linked ? '  [LINKED]' : ''}\n${sk.desc}` +
      (sk.long ? `\n\n${sk.long}` : '');
    this.tooltip.setText(txt);
    this.tooltip.setPosition(slot.container.x + 80, slot.container.y - slot.h - 8);
    this.tooltip.setVisible(true);
  }

  castFlash(index) {
    const slot = this.slots[index];
    if (!slot) return;
    this.scene.tweens.add({
      targets: slot.container, scaleX: 1.1, scaleY: 1.1,
      duration: 100, yoyo: true,
    });
  }

  setMode(mode) {
    const c = mode === 'enemy' ? COLORS.enemy : COLORS.hero;
    this.beatDot.setFillStyle(c, 0.22);
    this.beatDot.setStrokeStyle(2, c, 0.9);
  }

  onBeat() {
    this.scene.tweens.add({
      targets: this.avatar, scaleY: 0.94, scaleX: 1.03,
      duration: 80, yoyo: true,
    });
    this.scene.tweens.add({
      targets: this.beatDot, scaleX: 1.25, scaleY: 0.85,
      duration: 80, yoyo: true,
    });
  }

  /** ASSETS.md §6: hero attacks — play the attack anim once, then idle. */
  playAttack() {
    if (!this.animSprite) return;
    if (!this.scene.anims.exists('hanim_attack')) return; // partial hero sheet
    this.animSprite.play('hanim_attack');
    this.animSprite.once('animationcomplete', () => {
      if (this.animSprite?.anims?.currentAnim?.key !== 'hanim_idle') {
        this.animSprite.play('hanim_idle');
      }
    });
  }

  /** ASSETS.md §6: hero takes damage — hurt anim once, then idle. */
  playHurt() {
    if (!this.animSprite) return;
    if (!this.scene.anims.exists('hanim_hurt')) return; // partial hero sheet
    this.animSprite.play('hanim_hurt');
    this.animSprite.once('animationcomplete', () => {
      if (this.animSprite?.anims?.currentAnim?.key !== 'hanim_idle') {
        this.animSprite.play('hanim_idle');
      }
    });
  }

  flashHurt() {
    if (this.animSprite) { this.playHurt(); return; }
    if (this.avatarImg) this.avatarImg.setTint(COLORS.enemy);
    else this.avatarBody?.setFillStyle(COLORS.enemy);
    this.scene.time.delayedCall(140, () => {
      if (this.avatarImg) this.avatarImg.clearTint();
      else this.avatarBody?.setFillStyle(COLORS.cyan);
    });
  }

  flashHeal() {
    if (this.avatarImg) this.avatarImg.setTint(COLORS.hero);
    else this.avatarBody?.setFillStyle(COLORS.hero);
    this.scene.time.delayedCall(180, () => {
      if (this.avatarImg) this.avatarImg.clearTint();
      else this.avatarBody?.setFillStyle(COLORS.cyan);
    });
  }

  refresh() {
    const r = this.run;
    this.lensText?.setText(`◈ ${Math.max(0, Math.floor(r.lens || 0))}`);
    const hpPct = Phaser.Math.Clamp(r.hp / r.maxHp, 0, 1);
    this.hpFill.width = Math.max(0, (this.hpBg.width - 4) * hpPct);
    this.hpFill.setFillStyle(hpPct < 0.25 ? COLORS.enemy : hpPct < 0.5 ? COLORS.amber : COLORS.hero);

    const mpPct = Phaser.Math.Clamp(r.mana / r.maxMana, 0, 1);
    this.mpFill.width = Math.max(0, (this.mpBg.width - 4) * mpPct);

    // pet dot / art
    const s = this.scene;
    if (r.pet) {
      const base = PET_BY_ID[r.pet.id];
      const petTex = hasTexture(s, `pet_${r.pet.id}`);
      if (petTex) {
        this.petDot.setVisible(false);
        if (!this.petImg) {
          this.petImg = s.add.image(this.petDot.x, this.petDot.y, `pet_${r.pet.id}`)
            .setDisplaySize(14, 14);
        }
        this.petImg.setVisible(true).setTexture(`pet_${r.pet.id}`);
      } else {
        this.petImg?.setVisible(false);
        this.petDot.setFillStyle(base?.color ?? 0x555577).setVisible(true);
      }
    } else {
      this.petDot.setVisible(false);
      this.petImg?.setVisible(false);
    }

    // skill slots
    this.slots.forEach((slot, i) => {
      const id = r.skills[i];
      slot.skillId = id || null;
      if (!id) {
        slot.label.setText('—').setColor('#33334f');
        slot.cost.setText('');
        slot.box.setStrokeStyle(1, 0x2a2a44);
        slot.box.setFillStyle(0x141424, 1);
        return;
      }
      const sk = SKILL_BY_ID[id];
      const isActive = sk.type !== SKILL_TYPE.PASSIVE;
      const affordable = !isActive || r.mana >= sk.cost;
      const linked = sk.linksWith && r.hasSkill(sk.linksWith);

      // ASSETS.md: skill art replaces the abbreviated label inside the slot
      const iconKey = `skill_${id}`;
      if (hasTexture(s, iconKey)) {
        if (!slot.icon) {
          slot.icon = s.add.image(0, -1, iconKey).setDisplaySize(34, 34);
          slot.container.add(slot.icon);
        }
        slot.icon.setTexture(iconKey).setVisible(true)
          .setAlpha(isActive && !affordable ? 0.35 : 1);
        slot.label.setVisible(false);
      } else {
        slot.icon?.setVisible(false);
        slot.label.setVisible(true);
        const name = sk.name.length > 9 ? sk.name.slice(0, 8) + '…' : sk.name;
        slot.label.setText((linked ? '⛓ ' : '') + name)
          .setColor(isActive ? (affordable ? CSS.textPrimary : CSS.textDim) : '#9be15d');
      }
      slot.cost.setText(isActive ? `${sk.cost}` : 'P')
        .setColor(isActive ? (affordable ? CSS.cyan : '#44446a') : '#4a7a3a');
      slot.box.setStrokeStyle(1, isActive && affordable ? 0x3a3a5f : 0x2a2a44);
      slot.box.setFillStyle(isActive && affordable ? 0x1a1a30 : 0x141424, 1);
    });
  }
}
