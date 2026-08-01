import Phaser from 'phaser';
import { music } from '../core/MusicEngine.js';
import { saveManager } from '../core/SaveManager.js';
import { RunState } from '../core/RunState.js';
import { SKILL_BY_ID, UNLOCKABLE } from '../data/skills.js';
import { PETS } from '../data/pets.js';
import { makeEnemy } from '../data/enemies.js';
import { COLORS, CSS, FONT } from '../core/Theme.js';
import { drawBackdrop } from '../ui/backdrop.js';
import { makeButton, makeCard, openModal } from '../ui/widgets.js';
import { hasTexture } from '../core/Assets.js';
import { playMenuBgm } from '../core/Bgm.js';

export class MenuScene extends Phaser.Scene {
  constructor() { super('Menu'); }

  create() {
    const { width: W, height: H } = this.scale;
    this.cameras.main.setBackgroundColor(CSS.bg);
    drawBackdrop(this);
    const m = saveManager.meta;
    const savedRun = saveManager.hasRun() ? RunState.deserialize(saveManager.data.run) : null;
    const nextEnemy = makeEnemy(savedRun?.level || 1);

    // DESIGN §7.1: Neon Arcade Runway. The road remains the stage and the UI
    // answers one question first: can I continue my current Ball Hop run?
    let title;
    if (hasTexture(this, 'logo')) {
      title = this.add.image(W / 2, 64, 'logo');
      title.setScale(94 / title.height);
    } else {
      title = this.add.text(W / 2, 64, 'RYTHMIC', {
        fontFamily: FONT.logo, fontSize: '56px', color: CSS.cyan,
      }).setOrigin(0.5);
      title.setShadow(0, 0, CSS.cyan, 14, true, false);
    }
    title.setY(30).setAlpha(0);
    this.tweens.add({ targets: title, y: 64, alpha: 1, duration: 350, ease: 'Quad.easeOut' });

    // Development shortcut for playtesting the second minigame without
    // clearing or advancing the player's saved run. It uses the same utility
    // button language as the dashboard controls and lives in the unused top
    // right corner so the main Ball Hop action remains dominant.
    const osuTestBtn = makeButton(this, {
      x: W - 138, y: 34, w: 238, h: 36,
      label: 'SKIP TO OSU  L11', color: COLORS.amber,
      fontSize: 12, variant: 'utility',
      onClick: () => this.startOsuTest(),
    });
    osuTestBtn.container.setDepth(3);

    this.add.text(W / 2, 116, 'MOUSE-ONLY RHYTHM ROGUELIKE', {
      fontFamily: FONT.body, fontSize: '14px', fontStyle: '600', color: CSS.textDim,
    }).setOrigin(0.5);

    // The avatar is decorative, but makes the menu feel like the moment before
    // entering the runway. It intentionally sits behind the actions.
    if (hasTexture(this, 'hero_avatar')) {
      const hero = this.add.image(W / 2, 230, 'hero_avatar').setDisplaySize(218, 218).setDepth(1);
      hero.setAlpha(0);
      this.tweens.add({ targets: hero, y: 218, alpha: 1, duration: 250, ease: 'Quad.easeOut' });
    }

    const mainBtn = makeButton(this, {
      x: W / 2, y: 352, w: 548, h: 68,
      label: savedRun ? 'CONTINUE RUN' : 'START BALL HOP', color: COLORS.magenta,
      fontSize: 24, variant: 'primary',
      onClick: () => savedRun ? this.continueRun() : this.startNewRun(),
    });
    mainBtn.container.setDepth(3);
    const newRunBtn = makeButton(this, {
      x: W / 2, y: 405, w: 310, h: 40, label: 'NEW RUN', color: COLORS.cyan,
      fontSize: 15, variant: 'secondary', onClick: () => this.showNewRunConfirm(),
    });
    newRunBtn.container.setDepth(3);

    this.buildMissionCard(savedRun, nextEnemy);

    // A continuous utility rail is quieter than the previous stack of equal
    // buttons. It deliberately lives at the edge of the stage.
    const footerY = H - 56;
    const footer = makeCard(this, { x: W / 2, y: footerY, w: W - 72, h: 56, radius: 12 });
    footer.container.setDepth(2);
    const items = [
      { label: 'PRACTICE', x: W * 0.28, onClick: () => this.showPractice() },
      { label: `UNLOCKS  ${m.shards}`, x: W * 0.50, onClick: () => this.showUnlocks() },
      { label: 'AUDIO', x: W * 0.72, onClick: () => this.showAudio() },
    ];
    [W * 0.39, W * 0.61].forEach((x) => {
      this.add.rectangle(x, footerY, 1, 24, COLORS.divider, 1).setDepth(3);
    });
    items.forEach((item) => {
      const b = makeButton(this, {
        x: item.x, y: footerY, w: 220, h: 42, label: item.label,
        icon: item.label.startsWith('PRACTICE') ? 'practice' : item.label.startsWith('UNLOCKS') ? 'unlocks' : 'audio',
        color: item.label.startsWith('UNLOCKS') ? COLORS.magenta : COLORS.cyan,
        fontSize: 15, variant: 'utility', onClick: item.onClick,
      });
      b.container.setDepth(3);
      if (item.label.startsWith('UNLOCKS')) this.unlocksBtn = b;
    });

    this.add.text(W - 14, H - 14,
      `offset ${saveManager.settings.audioOffsetMs > 0 ? '+' : ''}${saveManager.settings.audioOffsetMs}ms`, {
      fontFamily: FONT.body, fontSize: '13px', color: CSS.textFaint,
    }).setOrigin(1, 1);

    // CC BY 4.0 attribution (required by incompetech licensing) + menu BGM.
    this.add.text(14, H - 14,
      '♫ Kevin MacLeod (incompetech.com) — CC BY 4.0', {
      fontFamily: FONT.body, fontSize: '12px', color: CSS.textFaint,
    }).setOrigin(0, 1);
    playMenuBgm(this);
  }

  buildMissionCard(run, enemy) {
    const { width: W } = this.scale;
    const cx = W / 2;
    const card = makeCard(this, { x: cx, y: 500, w: 720, h: 94, radius: 12 });
    card.container.setDepth(1);
    const level = run?.level || 1;
    const progress = Math.round(((level - 1) / 20) * 100);

    this.add.text(cx - 325, 466, run ? 'CURRENT RUN' : 'NEXT HOP', {
      fontFamily: FONT.body, fontSize: '13px', fontStyle: '600', color: CSS.cyan,
    }).setDepth(2);
    this.add.text(cx - 325, 486, 'LEVEL', {
      fontFamily: FONT.display, fontSize: '14px', fontStyle: '700', color: CSS.cyan,
    }).setDepth(2);
    this.add.text(cx - 325, 501, String(level).padStart(2, '0'), {
      fontFamily: FONT.display, fontSize: '34px', fontStyle: '700', color: CSS.cyan,
    }).setDepth(2);
    this.add.rectangle(cx - 186, 500, 1, 54, COLORS.cyan, 0.75).setDepth(2);
    this.add.text(cx - 154, 472, enemy.name.toUpperCase(), {
      fontFamily: FONT.display, fontSize: '20px', fontStyle: '700', color: CSS.textPrimary,
    }).setDepth(2);
    this.add.text(cx - 154, 501, `${enemy.isBoss ? 'BOSS ROUTE' : 'CLEAR PROGRESS'}  ${progress}%`, {
      fontFamily: FONT.body, fontSize: '12px', fontStyle: '600', color: enemy.isBoss ? CSS.amber : CSS.textDim,
    }).setDepth(2);
    const bar = this.add.graphics().setDepth(2);
    bar.fillStyle(COLORS.divider, 1); bar.fillRoundedRect(cx - 154, 526, 220, 8, 4);
    bar.fillStyle(COLORS.magenta, 1); bar.fillRoundedRect(cx - 154, 526, 220 * Math.max(0.04, progress / 100), 8, 4);
    if (hasTexture(this, `enemy_${enemy.level}`)) {
      this.add.image(cx + 274, 500, `enemy_${enemy.level}`).setDisplaySize(64, 64).setDepth(2);
    } else {
      this.add.circle(cx + 274, 500, 28, enemy.color, 0.82).setDepth(2);
    }

    const metrics = [
      ['BEST ACCURACY', `${(saveManager.meta.bestAccuracy * 100).toFixed(0)}%`, COLORS.cyan],
      ['BEST LEVEL', String(saveManager.meta.bestLevel || 1).padStart(2, '0'), COLORS.magenta],
      ['SHARDS', saveManager.meta.shards.toLocaleString(), COLORS.amber],
    ];
    metrics.forEach(([label, value, color], i) => {
      const x = cx + (i - 1) * 245;
      const metric = makeCard(this, { x, y: 580, w: 226, h: 58, radius: 9 });
      metric.container.setDepth(1);
      this.add.text(x, 564, label, {
        fontFamily: FONT.body, fontSize: '12px', fontStyle: '600', color: CSS.textDim,
      }).setOrigin(0.5).setDepth(2);
      this.add.text(x, 586, value, {
        fontFamily: FONT.display, fontSize: '25px', fontStyle: '700', color: `#${color.toString(16).padStart(6, '0')}`,
      }).setOrigin(0.5).setDepth(2);
    });
  }

  continueRun() {
    const run = RunState.deserialize(saveManager.data.run);
    music.sfx('ui');
    this.scene.start('Level', { run });
  }

  startNewRun() {
    saveManager.clearRun();
    const run = new RunState();
    run.grantLevelPoints();
    music.sfx('ui');
    this.scene.start('Upgrade', { run, firstTime: true });
  }

  /** Start an unsaved level-11 run for quickly testing Osu mouse movement. */
  startOsuTest() {
    const run = new RunState(Date.now());
    run.level = 11;
    run.hp = run.maxHp;
    run.mana = run.maxMana;
    music.sfx('ui');
    this.scene.start('Level', { run });
  }

  showNewRunConfirm() {
    if (!saveManager.hasRun()) { this.startNewRun(); return; }
    openModal(this, { w: 560, h: 300, build: (content, close) => {
      const scene = content.scene;
      content.add(scene.add.text(280, 52, 'ABANDON CURRENT RUN?', {
        fontFamily: FONT.display, fontSize: '25px', fontStyle: '700', color: CSS.enemy,
      }).setOrigin(0.5));
      content.add(scene.add.text(280, 108,
        'Your current run will be lost. Shards are only earned when a run ends.', {
          fontFamily: FONT.body, fontSize: '17px', color: CSS.textSecondary, align: 'center', wordWrap: { width: 420 },
        }).setOrigin(0.5));
      const cancel = makeButton(scene, { x: 176, y: 232, w: 190, h: 46, label: 'CANCEL', color: COLORS.cyan, fontSize: 15, variant: 'secondary', onClick: close });
      const confirm = makeButton(scene, { x: 384, y: 232, w: 190, h: 46, label: 'START NEW RUN', color: COLORS.magenta, fontSize: 14, variant: 'primary', onClick: () => this.startNewRun() });
      content.add([cancel.container, confirm.container]);
    }});
  }

  showPractice() {
    openModal(this, { w: 520, h: 260, build: (content, close) => {
      const scene = content.scene;
      content.add(scene.add.text(260, 56, 'BALL HOP PRACTICE', {
        fontFamily: FONT.display, fontSize: '24px', fontStyle: '700', color: CSS.cyan,
      }).setOrigin(0.5));
      content.add(scene.add.text(260, 112,
        'Practice will replay a route without risking your active run. It is the next Ball Hop feature.', {
          fontFamily: FONT.body, fontSize: '17px', color: CSS.textSecondary, align: 'center', wordWrap: { width: 390 },
        }).setOrigin(0.5));
      const closeBtn = makeButton(scene, { x: 260, y: 205, w: 180, h: 44, label: 'CLOSE', color: COLORS.cyan, fontSize: 15, variant: 'secondary', onClick: close });
      content.add(closeBtn.container);
    }});
  }

  showAudio() {
    openModal(this, { w: 560, h: 360, build: (content, close) => {
      const scene = content.scene;
      content.add(scene.add.text(280, 42, 'AUDIO CONTROL', {
        fontFamily: FONT.display, fontSize: '25px', fontStyle: '700', color: CSS.cyan,
      }).setOrigin(0.5));
      const makeVolume = (label, key, y) => {
        const value = scene.add.text(280, y, '', { fontFamily: FONT.display, fontSize: '25px', fontStyle: '700', color: CSS.textPrimary }).setOrigin(0.5);
        const refresh = () => value.setText(`${label}  ${Math.round(saveManager.settings[key] * 100)}%`);
        const down = makeButton(scene, { x: 180, y, w: 66, h: 42, label: '−', color: COLORS.cyan, fontSize: 20, variant: 'secondary', onClick: () => { saveManager.setSetting(key, Phaser.Math.Clamp(saveManager.settings[key] - 0.05, 0, 1)); if (key === 'musicVol') music.setMusicVolume(saveManager.settings[key]); else music.setSfxVolume(saveManager.settings[key]); refresh(); } });
        const up = makeButton(scene, { x: 380, y, w: 66, h: 42, label: '+', color: COLORS.cyan, fontSize: 20, variant: 'secondary', onClick: () => { saveManager.setSetting(key, Phaser.Math.Clamp(saveManager.settings[key] + 0.05, 0, 1)); if (key === 'musicVol') music.setMusicVolume(saveManager.settings[key]); else music.setSfxVolume(saveManager.settings[key]); refresh(); } });
        content.add([value, down.container, up.container]); refresh();
      };
      makeVolume('MUSIC', 'musicVol', 116);
      makeVolume('SFX', 'sfxVol', 176);
      const calibrate = makeButton(scene, { x: 280, y: 244, w: 280, h: 44, label: 'RECALIBRATE AUDIO', color: COLORS.magenta, fontSize: 14, variant: 'primary', onClick: () => this.scene.start('Calibration') });
      const closeBtn = makeButton(scene, { x: 280, y: 302, w: 160, h: 36, label: 'CLOSE', color: COLORS.cyan, fontSize: 13, variant: 'secondary', onClick: close });
      content.add([calibrate.container, closeBtn.container]);
    }});
  }

  // ------------------------------------------------------------ unlocks modal
  showUnlocks() {
    openModal(this, {
      w: 1180, h: 660,
      build: (c, close) => this.buildUnlocks(c, close),
    });
  }

  buildUnlocks(content, close) {
    const scene = content.scene;
    const shards = () => saveManager.meta.shards;
    // content coordinates are relative to the modal card (1180×660)
    const MW = 1180;

    const title = scene.add.text(34, 34, 'UNLOCKS', {
      fontFamily: FONT.display, fontSize: '32px', fontStyle: '700', color: CSS.magenta,
    });
    content.add(title);

    const shardText = scene.add.text(MW - 34, 40, `◆ ${shards()}`, {
      fontFamily: FONT.display, fontSize: '22px', fontStyle: '700', color: CSS.amber,
    }).setOrigin(1, 0);
    content.add(shardText);

    const hint = scene.add.text(34, 76,
      'Unlocks widen the pool of what you can be OFFERED. They never grant raw power.', {
      fontFamily: FONT.body, fontSize: '15px', color: CSS.textDim,
    });
    content.add(hint);

    // skill cards — 5 columns × 2 rows
    UNLOCKABLE.forEach((u, i) => {
      const sk = SKILL_BY_ID[u.id];
      const col = i % 5, row = Math.floor(i / 5);
      const x = 40 + col * 224;
      const y = 106 + row * 104;
      this.makeUnlockCard(content, x, y, {
        id: u.id, name: sk.name, desc: sk.desc, cost: u.cost,
        owned: () => saveManager.meta.unlockedSkills.includes(u.id),
        canAfford: () => saveManager.meta.shards >= u.cost,
      }, (card) => {
        if (saveManager.unlockSkill(u.id, u.cost)) {
          music.sfx('levelup');
          card.setHover(COLORS.hero);
          card.setInteractive(false);
          shardText.setText(`◆ ${shards()}`);
          this.unlocksBtn.setLabel(`UNLOCKS  (◆ ${shards()})`);
        } else {
          music.sfx('miss');
        }
      });
    });

    // pets — one row
    const petTitle = scene.add.text(34, 330, 'PETS', {
      fontFamily: FONT.display, fontSize: '22px', fontStyle: '700', color: CSS.hero,
    });
    content.add(petTitle);

    PETS.forEach((p, i) => {
      const x = 40 + i * 188;
      const y = 360;
      const owned = saveManager.meta.unlockedPets.includes(p.id);
      const card = makeCard(scene, { x: x + 88, y: y + 83, w: 176, h: 166, interactive: !owned });
      const c = card.container;
      content.add(c);

      const nameT = scene.add.text(x + 88, y + 52, p.name, {
        fontFamily: FONT.body, fontSize: '17px', fontStyle: 'bold',
        color: owned ? CSS.hero : CSS.textPrimary,
      }).setOrigin(0.5);
      content.add(nameT);
      // ASSETS.md: pet art replaces the colour dot when provided
      if (hasTexture(scene, `pet_${p.id}`)) {
        content.add(scene.add.image(x + 88, y + 30, `pet_${p.id}`).setDisplaySize(56, 56));
      } else {
        content.add(scene.add.circle(x + 88, y + 30, 14, p.color));
      }
      content.add(scene.add.text(x + 88, y + 74, p.species, {
        fontFamily: FONT.body, fontSize: '12px', color: CSS.textDim,
      }).setOrigin(0.5));
      content.add(scene.add.text(x + 88, y + 94, p.desc, {
        fontFamily: FONT.body, fontSize: '13px', color: CSS.textSecondary,
        align: 'center', wordWrap: { width: 156 },
      }).setOrigin(0.5, 0));

      if (owned) {
        content.add(scene.add.text(x + 8, y + 8, '✔', {
          fontFamily: FONT.body, fontSize: '17px', fontStyle: 'bold', color: CSS.hero,
        }));
      } else {
        const costT = scene.add.text(x + 168, y + 10, '◆ 500', {
          fontFamily: FONT.body, fontSize: '15px', fontStyle: '600',
          color: saveManager.meta.shards >= 500 ? CSS.amber : CSS.textDim,
        }).setOrigin(1, 0);
        content.add(costT);
        c.on('pointerdown', () => {
          if (saveManager.unlockPet(p.id, 500)) {
            music.sfx('levelup');
            card.setHover(COLORS.hero);
            card.setInteractive(false);
            costT.destroy();
            nameT.setColor(CSS.hero);
            content.add(scene.add.text(x + 8, y + 8, '✔', {
              fontFamily: FONT.body, fontSize: '17px', fontStyle: 'bold', color: CSS.hero,
            }));
            shardText.setText(`◆ ${shards()}`);
            this.unlocksBtn.setLabel(`UNLOCKS  (◆ ${shards()})`);
          } else music.sfx('miss');
        });
      }
    });

    const closeBtn = makeButton(scene, {
      x: MW / 2, y: 604, w: 180, h: 44, label: 'CLOSE', fontSize: 17,
      onClick: close,
    });
    content.add(closeBtn.container);
  }

  /** One unlock card: name + desc + cost badge / owned check. */
  makeUnlockCard(content, x, y, { id, name, desc, cost, owned, canAfford }, onBuy) {
    const scene = content.scene;
    const card = makeCard(scene, { x: x + 107, y: y + 52, w: 214, h: 104, interactive: !owned() && canAfford() });
    const c = card.container;
    content.add(c);

    // ASSETS.md: skill art sits top-left of the card; text shifts right
    const hasIcon = hasTexture(scene, `skill_${id}`);
    const contentX = hasIcon ? x + 52 : x + 12;
    const descW = hasIcon ? 152 : 192;
    if (hasIcon) {
      content.add(scene.add.image(x + 15, y + 14, `skill_${id}`).setDisplaySize(32, 32));
    }

    const nameT = scene.add.text(contentX, y + 8, name, {
      fontFamily: FONT.body, fontSize: '16px', fontStyle: 'bold',
      color: owned() ? CSS.hero : CSS.textPrimary,
    });
    const descT = scene.add.text(contentX, y + 30, desc, {
      fontFamily: FONT.body, fontSize: '13px', color: CSS.textSecondary,
      wordWrap: { width: descW },
    });
    content.add(nameT);
    content.add(descT);

    if (owned()) {
      content.add(scene.add.text(x + 4, y + 2, '✔', {
        fontFamily: FONT.body, fontSize: '17px', fontStyle: 'bold', color: CSS.hero,
      }));
    } else {
      content.add(scene.add.text(x + 190, y + 86, `◆${cost}`, {
        fontFamily: FONT.body, fontSize: '15px', fontStyle: '600',
        color: canAfford() ? CSS.amber : CSS.textDim,
      }).setOrigin(1, 0));
      if (canAfford()) c.on('pointerdown', () => onBuy(card));
    }
  }
}
