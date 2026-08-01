import Phaser from 'phaser';
import { music, mulberry32 } from '../core/MusicEngine.js';
import { saveManager } from '../core/SaveManager.js';
import { SKILL_BY_ID, STARTER_POOL, SKILL_TYPE } from '../data/skills.js';
import { PETS, PET_BY_ID, PET_LEVELS } from '../data/pets.js';
import { makeEnemy } from '../data/enemies.js';
import { COLORS, CSS, FONT, css } from '../core/Theme.js';
import { drawBackdrop } from '../ui/backdrop.js';
import { makeButton, makeCard, makeCircleButton, openModal, popText } from '../ui/widgets.js';
import { hasTexture } from '../core/Assets.js';
import { playMenuBgm } from '../core/Bgm.js';

/**
 * UpgradeScene — spend points, take a skill (or don't), meet a pet.
 *
 * Skipping a skill grants +1 stat point, so "no skill" is a real choice rather
 * than a wasted screen. Taking an 11th skill forces a drop, which is where the
 * interesting decisions live late in a run.
 *
 * DESIGN §7 layout: left stat card column, right skill offer cards + SKIP,
 * bottom Continue. All surfaces use widgets.js components and Theme tokens.
 *
 * Coordinate notes:
 *  - Scene-level cards: `makeCard` centres its container, so pass cardTop + h/2
 *    and keep card CONTENT in scene coordinates (not inside the container) —
 *    content then only misaligns by the 2px hover lift, which is invisible.
 *  - Modal content: everything is created with coordinates RELATIVE to the
 *    modal card's top-left and added to `content` (which sits at the card's
 *    top-left), so global = modal offset + relative.
 */
export class UpgradeScene extends Phaser.Scene {
  constructor() { super('Upgrade'); }

  init(data) {
    this.run = data.run;
    this.firstTime = !!data.firstTime;
    this.pendingDrop = null;

    // PHASER REUSES SCENE INSTANCES across scene.start(). Any latch set during
    // one visit is still set on the next one, so every such flag MUST be reset
    // here. Missing this made the skill offer unclickable from level 2 onward:
    // offersResolved stayed true forever, takeSkill() returned immediately, and
    // only the stat points still worked.
    this.offersResolved = false;
    this.offers = [];
    this.offerObjects = [];
  }

  create() {
    const { width: W, height: H } = this.scale;
    this.cameras.main.setBackgroundColor(CSS.bg);
    drawBackdrop(this, { horizonRatio: 0.26 });

    this.add.text(W / 2, 26,
      this.firstTime ? 'BUILD YOUR HERO' : `LEVEL ${this.run.level - 1} CLEARED`, {
      fontFamily: FONT.display, fontSize: '32px', fontStyle: '700',
      color: this.firstTime ? CSS.cyan : CSS.amber,
    }).setOrigin(0.5, 0);

    const next = makeEnemy(this.run.level);
    this.add.text(W / 2, 64,
      `Next: ${next.name}  ·  ${next.maxHp} HP  ·  ATK ${Math.round(next.atk)}  ·  ${next.bpm} BPM` +
      (next.isBoss ? '   ⚠ BOSS' : ''), {
      fontFamily: FONT.body, fontSize: '16px',
      color: next.isBoss ? CSS.amber : CSS.textDim,
    }).setOrigin(0.5, 0);

    this.buildStats();
    this.buildSkillOffer();
    this.maybeOfferPet();

    // DESIGN §5.2 primary action button; disabled until every point is spent.
    this.continueBtn = makeButton(this, {
      x: W / 2, y: H - 44, w: 360, h: 56, label: '', color: COLORS.hero, fontSize: 22,
      onClick: () => {
        music.sfx('ui');
        saveManager.saveRun(this.run);
        this.scene.start('Level', { run: this.run });
      },
    });
    this.continueBtn.setDisabled(true);

    // Menu BGM keeps playing through the upgrade screen (same track, no restart).
    playMenuBgm(this);

    this.refresh();
  }

  // ---------------------------------------------------------------- stats
  buildStats() {
    const x = 80, y = 118;

    this.add.text(x, y, 'STAT POINTS', {
      fontFamily: FONT.display, fontSize: '18px', fontStyle: '700', color: CSS.cyan,
    });

    // remaining-points dots (amber, DESIGN §7: "+1 stat / skip" accent)
    this.pointDots = this.add.graphics();
    this.pointsText = this.add.text(x + 150, y + 24, '', {
      fontFamily: FONT.body, fontSize: '16px', color: CSS.amber,
    });

    const stats = [
      ['hp', 'HEALTH', '+12 max HP', COLORS.great],
      ['mana', 'MANA', '+10 max mana + refill', COLORS.perfect],
      ['def', 'DEFENSE', '+4 DEF (diminishing)', COLORS.violet],
      ['atk', 'ATTACK', '+2 or +3 ATK', COLORS.orange],
    ];

    this.statRows = {};
    stats.forEach(([key, label, desc, color], i) => {
      const yy = y + 62 + i * 64;              // card top
      const card = makeCard(this, { x, y: yy + 26, w: 330, h: 52, radius: 10, interactive: false });
      const c = card.container;

      const name = this.add.text(x + 14, yy + 4, label, {
        fontFamily: FONT.body, fontSize: '16px', fontStyle: 'bold',
      }).setTint(color);
      const d = this.add.text(x + 14, yy + 24, desc, {
        fontFamily: FONT.body, fontSize: '13px', color: CSS.textDim,
      });
      const val = this.add.text(x + 252, yy + 10, '', {
        fontFamily: FONT.display, fontSize: '17px', fontStyle: '700', color: CSS.textPrimary,
      }).setOrigin(1, 0);

      const plus = makeCircleButton(this, {
        x: x + 308, y: yy + 26, r: 17, color: COLORS.cyan,
        onClick: () => {
          if (this.run.spendPoint(key)) {
            music.sfx('ui');
            this.refresh();
            popText(this, val, css(color));
          } else music.sfx('miss');
        },
      });

      this.statRows[key] = { card, val, plus, color };
    });

    this.derivedText = this.add.text(x, y + 62 + 4 * 64 + 8, '', {
      fontFamily: FONT.body, fontSize: '14px', color: CSS.textDim, lineSpacing: 4,
    });
  }

  // ---------------------------------------------------------------- skills
  buildSkillOffer() {
    const { width: W } = this.scale;
    const x = W / 2 + 30;
    const y = 118;

    this.add.text(x, y, `SKILLS  (${this.run.skills.length}/10)`, {
      fontFamily: FONT.display, fontSize: '18px', fontStyle: '700', color: CSS.violet,
    });

    // Offer 2 from the pool the player has unlocked and doesn't already carry
    const pool = [...STARTER_POOL, ...saveManager.meta.unlockedSkills]
      .filter((id, i, arr) => arr.indexOf(id) === i)
      .filter((id) => !this.run.hasSkill(id));

    const rng = mulberry32(this.run.seed + this.run.level * 7919);
    this.offers = [];
    for (let i = 0; i < 2 && pool.length; i++) {
      const idx = Math.floor(rng() * pool.length);
      this.offers.push(pool.splice(idx, 1)[0]);
    }

    this.offerObjects = [];
    this.offers.forEach((id, i) => {
      const sk = SKILL_BY_ID[id];
      const yy = y + 34 + i * 96;              // card top
      const linked = sk.linksWith && this.run.hasSkill(sk.linksWith);
      const typeColor = sk.type === SKILL_TYPE.PASSIVE ? COLORS.hero
        : sk.type === SKILL_TYPE.TOGGLE ? COLORS.amber : COLORS.cyan;

      const card = makeCard(this, { x, y: yy + 48, w: 420, h: 96, radius: 10, interactive: true });
      const c = card.container;
      if (linked) card.setHover(COLORS.amber);

      // type-colour left bar (scene-level so it does not shift with the card)
      const bar = this.add.graphics();
      bar.fillStyle(typeColor, 0.9);
      bar.fillRoundedRect(x - 210, yy, 4, 96, 2);

      const tag = sk.type === SKILL_TYPE.PASSIVE ? 'PASSIVE'
        : sk.type === SKILL_TYPE.TOGGLE ? 'TOGGLE' : `ACTIVE · ${sk.cost} mana`;

      // ASSETS.md: skill art sits on the left of the offer card; text shifts right
      const hasIcon = hasTexture(this, `skill_${id}`);
      const contentX = hasIcon ? x - 150 : x + 12;
      const descW = hasIcon ? 336 : 396;
      if (hasIcon) {
        this.add.image(x - 186, yy + 48, `skill_${id}`).setDisplaySize(44, 44);
      }

      this.add.text(contentX, yy + 8, `${linked ? '⛓ ' : ''}${sk.name}`, {
        fontFamily: FONT.body, fontSize: '18px', color: CSS.textPrimary, fontStyle: 'bold',
      });
      this.add.text(contentX, yy + 30, tag, {
        fontFamily: FONT.body, fontSize: '12px', fontStyle: '600', color: CSS.cyan,
      });
      this.add.text(contentX, yy + 46, sk.desc, {
        fontFamily: FONT.body, fontSize: '13px', color: CSS.textSecondary,
        wordWrap: { width: descW },
      });
      if (linked) {
        this.add.text(x + 408, yy + 8, 'LINKS WITH YOUR BUILD', {
          fontFamily: FONT.body, fontSize: '12px', color: CSS.amber,
        }).setOrigin(1, 0);
      }

      c.on('pointerdown', () => this.takeSkill(id, card));
      this.offerObjects.push(card);
    });

    const skipY = y + 34 + 2 * 96 + 6;
    this.skipBtn = makeButton(this, {
      x, y: skipY, w: 420, h: 46, label: 'SKIP  →  +1 stat point instead',
      color: COLORS.amber, fontSize: 16,
      onClick: () => {
        if (this.offersResolved) return;
        this.offersResolved = true;
        this.run.unspentPoints++;
        music.sfx('ui');
        this.offerObjects.forEach((b) => { b.container.setAlpha(0.25); b.setInteractive(false); });
        this.skipBtn.setDisabled(true);
        this.refresh();
      },
    });

    // current loadout
    this.loadoutText = this.add.text(x, skipY + 52, '', {
      fontFamily: FONT.body, fontSize: '13px', color: CSS.textDim,
      wordWrap: { width: 420 }, lineSpacing: 3,
    });
  }

  takeSkill(id, card) {
    if (this.offersResolved) return;
    if (this.run.skills.length >= 10) {
      this.promptDrop(id);
      return;
    }
    this.offersResolved = true;
    this.run.addSkill(id);
    music.sfx('levelup');
    // chosen card flashes + locks green; the rest dim
    card.setHover(COLORS.hero);
    this.tweens.add({ targets: card.container, scale: 1.05, duration: 90, yoyo: true });
    this.offerObjects.forEach((b) => {
      if (b !== card) { b.container.setAlpha(0.25); b.setInteractive(false); }
    });
    this.skipBtn.setDisabled(true);
    this.refresh();
  }

  promptDrop(newId) {
    const MW = 900, MH = 560;

    openModal(this, { w: MW, h: MH, build: (content, close) => {
      const scene = content.scene;
      content.add(scene.add.text(MW / 2, 44,
        `Loadout is full. Drop one to take ${SKILL_BY_ID[newId].name}.`, {
        fontFamily: FONT.body, fontSize: '20px', color: CSS.amber,
      }).setOrigin(0.5, 0));

      this.run.skills.forEach((id, i) => {
        const sk = SKILL_BY_ID[id];
        const col = i % 2, row = Math.floor(i / 2);
        const cx = 24 + col * 432 + 204;       // relative to modal card
        const cy = 96 + row * 62 + 27;
        const card = makeCard(scene, { x: cx, y: cy, w: 408, h: 54, radius: 8, interactive: true });
        const c = card.container;
        content.add(c);
        c.add(scene.add.text(cx - 204 + 12, cy - 27 + 7, sk.name, {
          fontFamily: FONT.body, fontSize: '16px', fontStyle: 'bold', color: CSS.textPrimary,
        }));
        c.add(scene.add.text(cx - 204 + 12, cy - 27 + 29, sk.desc, {
          fontFamily: FONT.body, fontSize: '13px', color: CSS.textSecondary,
          wordWrap: { width: 380 },
        }));
        c.on('pointerdown', () => {
          this.run.removeSkill(id);
          this.run.addSkill(newId);
          this.offersResolved = true;
          music.sfx('levelup');
          close();
          this.offerObjects.forEach((b) => { b.container.setAlpha(0.25); b.setInteractive(false); });
          this.skipBtn.setDisabled(true);
          this.refresh();
        });
      });

      const cancel = makeButton(scene, {
        x: MW / 2, y: MH - 52, w: 160, h: 44, label: 'CANCEL', fontSize: 16,
        onClick: close,
      });
      content.add(cancel.container);
    }});
  }

  // ---------------------------------------------------------------- pets
  maybeOfferPet() {
    if (!PET_LEVELS.includes(this.run.level)) return;
    const MW = 900, MH = 560;

    const owned = saveManager.meta.unlockedPets;
    const rng = mulberry32(this.run.seed + this.run.level * 31);
    const choices = PETS.filter((p) => owned.includes(p.id));
    if (!choices.length) return;

    openModal(this, { w: MW, h: MH, build: (content, close) => {
      const scene = content.scene;
      content.add(scene.add.text(MW / 2, 56, 'A COMPANION APPEARS', {
        fontFamily: FONT.display, fontSize: '32px', fontStyle: '700', color: CSS.hero,
      }).setOrigin(0.5, 0));

      const pick = choices.sort(() => rng() - 0.5).slice(0, 3);
      pick.forEach((p, i) => {
        const cx = MW / 2 + (i - (pick.length - 1) / 2) * 250;   // relative
        const cy = 260;
        const card = makeCard(scene, { x: cx, y: cy, w: 220, h: 190, interactive: true });
        const c = card.container;
        content.add(c);
        content.add(scene.add.circle(cx, cy - 46, 26, p.color));
        // ASSETS.md: pet art replaces the colour dot when provided
        if (hasTexture(scene, `pet_${p.id}`)) {
          content.add(scene.add.image(cx, cy - 46, `pet_${p.id}`).setDisplaySize(96, 96));
        }
        content.add(scene.add.text(cx, cy - 4, p.name, {
          fontFamily: FONT.body, fontSize: '20px', color: CSS.textPrimary, fontStyle: 'bold',
        }).setOrigin(0.5));
        content.add(scene.add.text(cx, cy + 18, p.species, {
          fontFamily: FONT.body, fontSize: '13px', color: CSS.textDim,
        }).setOrigin(0.5));
        content.add(scene.add.text(cx, cy + 56, p.desc, {
          fontFamily: FONT.body, fontSize: '13px', color: CSS.textSecondary,
          align: 'center', wordWrap: { width: 200 },
        }).setOrigin(0.5));

        c.on('pointerdown', () => {
          // Same pet again = level it up instead of replacing
          if (this.run.pet?.id === p.id) this.run.pet.level = Math.min(5, this.run.pet.level + 1);
          else this.run.pet = { id: p.id, level: 1 };
          music.sfx('levelup');
          close();
          this.refresh();
        });
      });

      const skip = scene.add.text(MW / 2, MH - 56, 'walk on by', {
        fontFamily: FONT.body, fontSize: '16px', color: CSS.textDim,
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      skip.on('pointerdown', () => close());
      content.add(skip);
    }});
  }

  // ---------------------------------------------------------------- refresh
  refresh() {
    const r = this.run;
    this.pointsText.setText(`${r.unspentPoints} point${r.unspentPoints === 1 ? '' : 's'} to spend`);
    this.pointsText.setColor(r.unspentPoints > 0 ? CSS.amber : CSS.textDim);

    // remaining-points dots
    this.pointDots.clear();
    for (let i = 0; i < Math.min(r.unspentPoints, 8); i++) {
      this.pointDots.fillStyle(COLORS.amber, 1);
      this.pointDots.fillCircle(220 + i * 16, 140, 4.5);
    }

    const vals = {
      hp: `${r.maxHp}`, mana: `${r.maxMana}`,
      def: `${Math.round(r.def)}`, atk: `${r.atk}`,
    };
    for (const k of Object.keys(this.statRows)) {
      const row = this.statRows[k];
      row.val.setText(`${vals[k]}  (+${r.points[k]})`);
      row.plus.setDisabled(r.unspentPoints <= 0);
      row.card.container.setAlpha(r.unspentPoints > 0 || r.points[k] > 0 ? 1 : 0.55);
    }

    this.derivedText.setText(
      `damage reduction  ${(r.defReduction * 100).toFixed(1)}%\n` +
      `pet multiplier  x${r.petMult.toFixed(2)}` +
      (r.pet ? `  (${PET_BY_ID[r.pet.id].name} L${r.pet.level})` : '  (none)') +
      `\ncurrent HP  ${Math.ceil(r.hp)} / ${r.maxHp}    mana  ${Math.floor(r.mana)} / ${r.maxMana}`);

    this.loadoutText.setText(
      r.skills.length
        ? 'Carrying: ' + r.skills.map((id) => SKILL_BY_ID[id].name).join(' · ')
        : 'Carrying nothing yet.');

    const done = r.unspentPoints <= 0;
    this.continueBtn.setDisabled(!done);
    this.continueBtn.setLabel(
      done ? `▶  FIGHT LEVEL ${r.level}` : `SPEND ${r.unspentPoints} MORE POINT${r.unspentPoints === 1 ? '' : 'S'}`);
  }
}
