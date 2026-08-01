import Phaser from 'phaser';
import { music, MusicEngine } from '../core/MusicEngine.js';
import { Conductor } from '../core/Conductor.js';
import { generateChart } from '../core/ChartGen.js';
import { JUDGMENTS } from '../core/Judge.js';
import { STAGE } from '../core/Layout.js';
import { COLORS, CSS, FONT } from '../core/Theme.js';
import { getMiniGame, visibleBeatsForLevel } from '../minigames/MiniGame.js';
import '../minigames/BallHop.js';
import '../minigames/OsuCircles.js';
import { stopMenuBgm } from '../core/Bgm.js';

/** Damage-free infinite practice for either movement minigame. */
export class PracticeScene extends Phaser.Scene {
  constructor() { super('Practice'); }

  init(data) {
    this.mode = data.mode === 'osu' ? 'osu' : 'ballhop';
    this.level = this.mode === 'osu' ? 11 : 1;
    this.finished = false;
    this.phrase = null;
    this.phraseIndex = -1;
    this.cycle = 0;
    this.combo = 0;
    this.hits = 0;
    this.misses = 0;
  }

  create() {
    this.cameras.main.setBackgroundColor(CSS.bg);
    this.stageBounds = STAGE;
    this.conductor = new Conductor(music);
    this.baseChart = generateChart(this.level, 1);
    this.cycleLength = this.baseChart.totalBeats;
    this.phrases = this.makeCycle(this.cycle);

    const MG = getMiniGame(this.baseChart.minigame);
    this.minigame = new MG(this, this.stageBounds, this.conductor, {
      onJudged: (judgment) => this.onJudged(judgment),
      visibleBeats: visibleBeatsForLevel(this.level),
      level: this.level,
    });
    this.minigame.create();
    this.minigame.setSpeedTier(1);
    this.minigame.setUpcoming(this.phrases[0]);

    this.title = this.add.text(24, 18,
      `${this.mode === 'osu' ? 'OSU CIRCLES' : 'BALL HOP'}  ·  INFINITE PRACTICE`, {
      fontFamily: FONT.display, fontSize: '22px', fontStyle: '700', color: CSS.cyan,
    }).setDepth(10);
    this.hint = this.add.text(24, 48, 'NO DAMAGE  ·  NO DAMAGE TAKEN  ·  PRESS ESC TO EXIT', {
      fontFamily: FONT.body, fontSize: '15px', fontStyle: '600', color: CSS.amber,
    }).setDepth(10);
    this.status = this.add.text(24, 76, 'READY', {
      fontFamily: FONT.body, fontSize: '14px', color: CSS.textDim,
    }).setDepth(10);
    this.judgeText = this.add.text(
      this.stageBounds.x + this.stageBounds.width / 2,
      this.stageBounds.y + this.stageBounds.height * 0.30, '', {
      fontFamily: FONT.display, fontSize: '30px', fontStyle: '700', color: '#ffffff',
    }).setOrigin(0.5).setAlpha(0).setDepth(10);

    this.input.keyboard.on('keydown-ESC', () => this.exitPractice());
    stopMenuBgm();
    this.conductor.onBeat = (beat) => this.onBeat(beat);
    music.start(MusicEngine.makeSong(this.level));
    this.conductor.reset();

    this.events.once('shutdown', () => {
      music.stop();
      this.minigame?.destroy();
    });
  }

  makeCycle(cycle) {
    const offset = cycle * this.cycleLength;
    return this.baseChart.phrases.map((phrase, i) => ({
      ...phrase,
      index: cycle * this.baseChart.phrases.length + i,
      startBeat: phrase.startBeat + offset,
    }));
  }

  onBeat(beat) {
    if (this.finished) return;
    if (!this.phrase && this.phraseIndex < 0 && beat >= this.phrases[0].startBeat - 1) {
      this.startNextPhrase();
      return;
    }
    if (!this.phrase) return;
    if (beat >= this.phrase.startBeat + this.phrase.lengthBeats) {
      this.minigame.endPhrase();
      this.phrase = null;
      this.startNextPhrase();
    }
  }

  startNextPhrase() {
    this.phraseIndex++;
    if (this.phraseIndex >= this.phrases.length) {
      this.cycle++;
      this.phrases = this.makeCycle(this.cycle);
      this.phraseIndex = 0;
    }
    this.phrase = this.phrases[this.phraseIndex];
    this.minigame.startPhrase(this.phrase);
    this.minigame.setUpcoming(this.phrases[this.phraseIndex + 1] || null);
    this.status.setText(
      `CYCLE ${this.cycle + 1}  ·  ${this.phrase.type === 'enemy' ? 'DEFEND' : 'ATTACK'}  ·  ` +
      `COMBO ${this.combo}  ·  HITS ${this.hits}  ·  MISSES ${this.misses}`);
  }

  onJudged(judgment) {
    if (judgment.weight > 0) {
      this.combo++;
      this.hits++;
      music.hit(judgment.name, this.combo);
      music.setComboLayer(Math.min(4, Math.floor(this.combo / 8)));
    } else {
      this.combo = 0;
      this.misses++;
      music.hit(JUDGMENTS.MISS.name);
      music.setComboLayer(0);
    }
    this.minigame.setCombo?.(this.combo);
    this.status.setText(
      `CYCLE ${this.cycle + 1}  ·  COMBO ${this.combo}  ·  HITS ${this.hits}  ·  MISSES ${this.misses}`);
    if (this.minigame.constructor.id !== 'osu') {
      this.judgeText.setText(judgment.name).setTint(judgment.color).setAlpha(1).setScale(1.2);
      this.tweens.killTweensOf(this.judgeText);
      this.tweens.add({ targets: this.judgeText, alpha: 0, scale: 1, duration: 360 });
    }
  }

  update() {
    if (this.finished) return;
    this.conductor.update();
    this.minigame.update();
  }

  exitPractice() {
    if (this.finished) return;
    this.finished = true;
    music.stop();
    this.scene.start('Menu');
  }
}
