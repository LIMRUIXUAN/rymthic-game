import Phaser from 'phaser';
import { music } from '../core/MusicEngine.js';
import { saveManager } from '../core/SaveManager.js';
import { SKILL_BY_ID } from '../data/skills.js';
import { PET_BY_ID } from '../data/pets.js';
import { COLORS, CSS, FONT } from '../core/Theme.js';
import { drawBackdrop } from '../ui/backdrop.js';
import { stopMenuBgm } from '../core/Bgm.js';
import { makeButton, makeCard } from '../ui/widgets.js';

export class GameOverScene extends Phaser.Scene {
  constructor() { super('GameOver'); }

  init(data) {
    this.run = data.run;
    this.won = !!data.won;
    this.cleared = !!data.cleared;
    this.quit = !!data.quit;
  }

  create() {
    // The end-of-run moment is silent on purpose: the death jingle lands
    // cleaner without a menu track underneath.
    stopMenuBgm();
    const { width: W, height: H } = this.scale;
    this.cameras.main.setBackgroundColor(CSS.bg);
    drawBackdrop(this, { horizonRatio: 0.22 });

    const shards = saveManager.endRun(this.run, this.cleared);

    const title = this.cleared ? 'RUN COMPLETE' : this.quit ? 'RUN ABANDONED' : 'RUN OVER';
    const color = this.cleared ? CSS.amber : CSS.enemy;

    this.add.text(W / 2, 90, title, {
      fontFamily: FONT.display, fontSize: '56px', fontStyle: '700', color,
    }).setOrigin(0.5);

    if (this.cleared) {
      this.add.text(W / 2, 142, 'You beat THE ENCORE. The beat is yours.', {
        fontFamily: FONT.body, fontSize: '18px', color: CSS.hero,
      }).setOrigin(0.5);
    }

    const r = this.run;
    const lines = [
      `reached level        ${r.level}`,
      `average accuracy     ${(r.avgAccuracy * 100).toFixed(1)}%`,
      `total damage dealt   ${Math.round(r.totalDamageDealt).toLocaleString()}`,
      `best combo           ${r.maxComboThisLevel}`,
      `lens collected       ${r.lens || 0}`,
      `final ATK / DEF      ${r.atk} / ${Math.round(r.def)}`,
      `pet                  ${r.pet ? `${PET_BY_ID[r.pet.id].name} L${r.pet.level}` : 'none'}`,
    ];

    const statsCard = makeCard(this, { x: W / 2, y: 282, w: 480, h: 184, radius: 12 });
    statsCard.container.setAlpha(0.96);
    this.add.text(W / 2, 204, lines.join('\n'), {
      fontFamily: FONT.body, fontSize: '17px', fontStyle: '600', color: '#c8c8e0',
      align: 'left', lineSpacing: 7,
    }).setOrigin(0.5, 0);

    if (r.skills.length) {
      this.add.text(W / 2, 340,
        'build: ' + r.skills.map((id) => SKILL_BY_ID[id].name).join(' · '), {
        fontFamily: FONT.body, fontSize: '15px', color: CSS.textDim,
        align: 'center', wordWrap: { width: W * 0.7 },
      }).setOrigin(0.5, 0);
    }

    this.add.text(W / 2, 400, `◆ ${shards} SHARDS EARNED`, {
      fontFamily: FONT.display, fontSize: '28px', fontStyle: '700', color: CSS.amber,
    }).setOrigin(0.5);

    this.add.text(W / 2, 432, `total ◆ ${saveManager.meta.shards} — spend them on UNLOCKS in the menu`, {
      fontFamily: FONT.body, fontSize: '15px', color: CSS.textDim,
    }).setOrigin(0.5);

    makeButton(this, {
      x: W / 2, y: H - 90, w: 360, h: 58, label: 'BACK TO MENU',
      color: this.cleared ? COLORS.amber : COLORS.magenta, fontSize: 18, variant: 'primary',
      onClick: () => { music.sfx('ui'); this.scene.start('Menu'); },
    });

    music.sfx(this.cleared ? 'levelup' : 'death');
  }
}
