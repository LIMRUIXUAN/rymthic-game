/**
 * TopHUD — DESIGN.md §2: the 56px top bar.
 *
 *   [enemy zone]                    PHRASE 3/8      [COMBO ×2.75]
 *   40px avatar · name · HP+ghost · skill icons ·   ACC 94.2%
 *   intent telegraph → next enemy skill (amber)
 *
 * Everything here reads from Theme.js / Layout.js — no hardcoded colours.
 */
import Phaser from 'phaser';
import { COLORS, CSS, FONT, css } from '../core/Theme.js';
import { TOP_HUD_H, HUD_PAD } from '../core/Layout.js';
import { enemyTexKey } from '../core/Assets.js';
import { hasEnemyAnim, enemyAnimTexKey, enemyAnimPrefix } from '../core/Anims.js';

export const ENEMY_STATE = {
  IDLE: 'idle', WINDUP: 'windup', ATTACK: 'attack',
  HURT: 'hurt', CAST: 'cast', DEATH: 'death',
};

export class TopHUD {
  constructor(scene, run, enemy) {
    this.scene = scene;
    this.run = run;
    this.enemy = enemy;
    this.state = ENEMY_STATE.IDLE;
    this.stateUntil = 0;
    this.build();
  }

  build() {
    const s = this.scene;
    const W = s.scale.width;
    const barH = TOP_HUD_H;

    // bar background + hairline
    const bg = s.add.graphics();
    bg.fillStyle(COLORS.panel, 1);
    bg.fillRect(0, 0, W, barH);
    bg.lineStyle(1, COLORS.stroke, 1);
    bg.lineBetween(0, barH - 1, W, barH - 1);

    // ---- enemy zone (left) ----
    const size = 80;             // 2× bigger avatar
    const ax = HUD_PAD;
    const ay = (barH - size) / 2;
    this.avatarX = ax + size / 2;
    this.avatarY = ay + size / 2;
    this.size = size;

    this.container = s.add.container(this.avatarX, this.avatarY);
    this.aura = s.add.circle(0, 0, size * 0.85, this.enemy.color, 0.14);

    // ASSETS.md §6: multi-frame sprite-sheet animation replaces the procedural
    // face entirely (idle/attack/hurt/cast/death rows). Fallback: static art,
    // then the procedural face.
    this.animSprite = null;
    this.avatarImg = null;
    this.body = null;
    this.eyeL = this.eyeR = this.pupilL = this.pupilR = null;
    this.mouth = null;
    const level = this.enemy.level;
    const tex = enemyTexKey(s, level);
    if (hasEnemyAnim(s, level)) {
      this.animSprite = s.add.sprite(0, 0, enemyAnimTexKey(level))
        .setDisplaySize(size * 1.15, size * 1.15);
      // idle is always registered (row 0); guard anyway so a partial sheet
      // still shows its first frame instead of spamming anim warnings
      if (s.anims.exists(`${enemyAnimPrefix(level)}_idle`)) {
        this.animSprite.play(`${enemyAnimPrefix(level)}_idle`);
      }
    } else if (tex) {
      this.avatarImg = s.add.image(0, 0, tex).setDisplaySize(size, size);
    } else {
      this.body = s.add.rectangle(0, 0, size, size * 1.15, this.enemy.color, 1);
      this.body.setStrokeStyle(2, 0xffffff, 0.25);
      this.eyeL = s.add.circle(-size * 0.19, -size * 0.16, size * 0.09, COLORS.panel);
      this.eyeR = s.add.circle(size * 0.19, -size * 0.16, size * 0.09, COLORS.panel);
      this.pupilL = s.add.circle(-size * 0.19, -size * 0.16, size * 0.04, COLORS.enemy);
      this.pupilR = s.add.circle(size * 0.19, -size * 0.16, size * 0.04, COLORS.enemy);
      this.mouth = s.add.rectangle(0, size * 0.20, size * 0.42, size * 0.07, COLORS.panel);
    }
    this.container.add([this.aura, this.animSprite, this.avatarImg, this.body,
      this.eyeL, this.eyeR, this.pupilL, this.pupilR, this.mouth]
      .filter(Boolean));

    this.crown = null;
    if (this.enemy.isBoss && !this.animSprite && !tex) {
      // procedural crown only when there is no art — ASSETS.md asks boss art
      // to carry its own crown/aura
      this.crown = s.add.triangle(0, -size * 0.72, 0, 14, 10, 0, 20, 14, COLORS.amber);
      this.container.add(this.crown);
    }

    // name + meta, right of the avatar
    const tx = ax + size + 10;
    this.nameText = s.add.text(tx, ay + 18, this.enemy.name, {
      fontFamily: FONT.body, fontSize: '16px', fontStyle: '600',
      color: this.enemy.isBoss ? CSS.amber : CSS.textPrimary,
    });
    this.metaText = s.add.text(tx, ay + 38, `LV ${this.enemy.level} · ${this.enemy.bpm} BPM`, {
      fontFamily: FONT.body, fontSize: '13px', color: CSS.textDim,
    });

    // HP bar with lagging ghost
    const barY = ay + 62;
    this.barX = tx;
    this.barW = 220;
    this.hpBg = s.add.rectangle(tx, barY, this.barW, 10, 0x1a1a2c).setOrigin(0, 0.5);
    this.hpBg.setStrokeStyle(1, COLORS.strokeHi);
    this.hpFillBack = s.add.rectangle(tx + 1, barY, this.barW - 2, 8, COLORS.amber, 0.5).setOrigin(0, 0.5);
    this.hpFill = s.add.rectangle(tx + 1, barY, this.barW - 2, 8, COLORS.enemy).setOrigin(0, 0.5);
    this.hpText = s.add.text(tx, barY + 12, '', {
      fontFamily: FONT.body, fontSize: '11px', color: CSS.textSecondary,
    });

    // enemy skill icons + intent telegraph (DESIGN §5.9)
    this.skillIcons = [];
    let ix = tx + this.barW + 12;
    (this.enemy.skills || []).slice(0, 2).forEach((sk) => {
      const ic = s.add.text(ix, barY, sk.name.slice(0, 4).toUpperCase(), {
        fontFamily: FONT.body, fontSize: '11px', fontStyle: '600', color: CSS.magenta,
      }).setOrigin(0, 0.5).setAlpha(0.9);
      this.skillIcons.push(ic);
      ix += 42;
    });
    this.intentText = s.add.text(ix, barY, '', {
      fontFamily: FONT.body, fontSize: '12px', fontStyle: '600', color: CSS.amber,
    }).setOrigin(0, 0.5);

    // telegraph floats above the avatar
    this.telegraph = s.add.text(this.avatarX, ay - 12, '', {
      fontFamily: FONT.display, fontSize: '14px', fontStyle: '700', color: CSS.enemy,
    }).setOrigin(0.5);

    // ---- center: phrase ----
    this.phraseText = s.add.text(W / 2, barH / 2, '', {
      fontFamily: FONT.display, fontSize: '16px', fontStyle: '700',
    }).setOrigin(0.5);

    // ---- right: combo + accuracy ----
    this.comboText = s.add.text(W - HUD_PAD, 7, '', {
      fontFamily: FONT.display, fontSize: '26px', fontStyle: '700', color: CSS.amber,
    }).setOrigin(1, 0);
    this.accText = s.add.text(W - HUD_PAD, 34, '', {
      fontFamily: FONT.body, fontSize: '15px', fontStyle: '600', color: CSS.cyan,
    }).setOrigin(1, 0);
  }

  setPhrase(text, colorHex) {
    this.phraseText.setText(text).setColor(css(colorHex));
  }

  setState(state, durationMs = 400) {
    this.state = state;
    this.stateUntil = performance.now() + durationMs;

    // ASSETS.md §6: sprite-sheet animation path — one anim per state, then
    // back to idle (death plays once and stays). Partial sheets (fewer than
    // 5 rows) fall through to the procedural feedback for the missing state.
    if (this.animSprite) {
      const map = {
        [ENEMY_STATE.IDLE]: 'idle', [ENEMY_STATE.WINDUP]: 'cast',
        [ENEMY_STATE.ATTACK]: 'attack', [ENEMY_STATE.HURT]: 'hurt',
        [ENEMY_STATE.CAST]: 'cast', [ENEMY_STATE.DEATH]: 'death',
      };
      const prefix = enemyAnimPrefix(this.enemy.level);
      const anim = `${prefix}_${map[state] || 'idle'}`;
      if (this.scene.anims.exists(anim)) {
        this.animSprite.play(anim, state === ENEMY_STATE.IDLE);
        if (state === ENEMY_STATE.DEATH) {
          this.animSprite.once('animationcomplete', () => {
            this.animSprite?.stop();
          });
        }
        if (state === ENEMY_STATE.ATTACK) {
          this.scene.tweens.add({ targets: this.container, x: this.container.x + 14, duration: 90, yoyo: true, ease: 'Quad.easeOut' });
        }
        return;
      }
      // Missing state anim: hide the sprite so the procedural death collapse
      // reads clearly, then fall through to the procedural feedback below.
      if (state === ENEMY_STATE.DEATH) this.animSprite.setVisible(false);
    }

    const s = this.scene;
    switch (state) {
      case ENEMY_STATE.ATTACK:
        s.tweens.add({ targets: this.container, x: this.container.x + 14, duration: 90, yoyo: true, ease: 'Quad.easeOut' });
        this.mouth?.setScale(1, 3.2);
        s.time.delayedCall(220, () => this.mouth?.setScale(1, 1));
        break;
      case ENEMY_STATE.HURT:
        if (this.avatarImg) this.avatarImg.setTint(0xffffff);
        else this.body?.setFillStyle(0xffffff);
        s.tweens.add({ targets: this.container, x: this.container.x + 6, duration: 55, yoyo: true, repeat: 2 });
        s.time.delayedCall(120, () => {
          if (this.avatarImg) this.avatarImg.clearTint();
          else this.body?.setFillStyle(this.enemy.color);
        });
        break;
      case ENEMY_STATE.CAST:
        s.tweens.add({ targets: this.aura, scale: 1.6, alpha: 0.45, duration: 260, yoyo: true });
        break;
      case ENEMY_STATE.WINDUP:
        s.tweens.add({ targets: this.container, scaleX: 0.86, scaleY: 1.16, duration: 200, yoyo: true });
        break;
      case ENEMY_STATE.DEATH:
        s.tweens.add({
          targets: this.container, scaleY: 0.05, scaleX: 1.4, alpha: 0,
          angle: 22, duration: 620, ease: 'Back.easeIn',
        });
        this.telegraph.setText('');
        break;
      default: break;
    }
  }

  showTelegraph(text) {
    this.telegraph.setText(text);
    this.scene.tweens.add({
      targets: this.telegraph, scale: 1.25, duration: 140, yoyo: true,
    });
    this.scene.time.delayedCall(1100, () => this.telegraph?.setText(''));
  }

  setSkillLabel(text) { this.intentText?.setText(text); }

  /** DESIGN §5.9: show which enemy skill is coming next phrase. */
  showIntent(skill) {
    this.intentText.setText(skill ? `→ ${skill.name.toUpperCase()}` : '');
  }

  onBeat() {
    if (this.state === ENEMY_STATE.DEATH) return;
    this.scene.tweens.add({
      targets: this.container, scaleY: 0.93, scaleX: 1.04,
      duration: 80, yoyo: true, ease: 'Quad.easeOut',
    });
  }

  update() {
    if (this.state === ENEMY_STATE.DEATH) return;

    // sprite-sheet animation: return to idle once a transient state times out
    if (this.animSprite) {
      if (this.state === ENEMY_STATE.IDLE) {
        this.animSprite.play(`${enemyAnimPrefix(this.enemy.level)}_idle`, true);
      } else if (performance.now() > this.stateUntil) {
        this.state = ENEMY_STATE.IDLE;
        this.animSprite.play(`${enemyAnimPrefix(this.enemy.level)}_idle`, true);
      }
      this.container.y = this.avatarY + Math.sin(performance.now() / 620) * 4;
      return;
    }

    // procedural eyes track the play area (skipped when using art)
    if (this.pupilL && this.pupilR) {
      const p = this.scene.input.activePointer;
      const dx = Phaser.Math.Clamp((p.x - this.container.x) / 300, -1, 1) * this.size * 0.035;
      const dy = Phaser.Math.Clamp((p.y - this.avatarY) / 300, -1, 1) * this.size * 0.035;
      this.pupilL.setPosition(-this.size * 0.19 + dx, -this.size * 0.16 + dy);
      this.pupilR.setPosition(this.size * 0.19 + dx, -this.size * 0.16 + dy);
    }

    if (this.state !== ENEMY_STATE.IDLE && performance.now() > this.stateUntil) {
      this.state = ENEMY_STATE.IDLE;
    }
    this.container.y = this.avatarY + Math.sin(performance.now() / 620) * 4;
  }

  refresh() {
    const pct = Phaser.Math.Clamp(this.enemy.hp / this.enemy.maxHp, 0, 1);
    this.hpFill.width = Math.max(0, (this.barW - 2) * pct);
    this.hpText.setText(`${Math.ceil(this.enemy.hp)} / ${this.enemy.maxHp}`);
    this.scene.tweens.add({
      targets: this.hpFillBack, width: Math.max(0, (this.barW - 2) * pct),
      duration: 420, ease: 'Quad.easeOut',
    });
  }

  destroy() {
    this.container?.destroy(true);
  }
}
