import Phaser from 'phaser';
import { music } from '../core/MusicEngine.js';
import { saveManager } from '../core/SaveManager.js';
import { COLORS, CSS, FONT } from '../core/Theme.js';
import { drawBackdrop } from '../ui/backdrop.js';
import { stopMenuBgm } from '../core/Bgm.js';
import { makeButton } from '../ui/widgets.js';

/**
 * CalibrationScene — measures the player's audio+input offset.
 *
 * This is not optional polish. Every machine has a different output buffer, and
 * every player has a different reaction bias. Without this, "the game feels off"
 * is the single most common complaint about browser rhythm games, and it is
 * completely invisible to the developer whose own machine happens to be fast.
 *
 * We take the MEDIAN of the taps, not the mean, so one fumbled tap doesn't skew
 * the whole calibration.
 */
export class CalibrationScene extends Phaser.Scene {
  constructor() { super('Calibration'); }

  create() {
    // Never start over a leftover: clicks from a previous calibration visit are
    // still scheduled on the audio clock (they fire for up to ~24s), and a song
    // left playing would layer under the metronome. Kill both before scheduling.
    music.stop();
    music.cancelClicks();
    // The menu track must be silent too — the metronome is the only audio here.
    stopMenuBgm();

    const { width: W, height: H } = this.scale;
    this.cameras.main.setBackgroundColor(CSS.bg);
    drawBackdrop(this, { horizonRatio: 0.42 });
    this.taps = [];
    this.needed = 8;

    this.add.text(W / 2, 70, 'CALIBRATION', {
      fontFamily: FONT.display, fontSize: '40px', fontStyle: '700', color: CSS.cyan,
    }).setOrigin(0.5);

    this.add.text(W / 2, 122,
      'Click on every beat. Eight taps.\nThis measures your hardware delay so the timing is fair.', {
      fontFamily: FONT.body, fontSize: '17px', color: CSS.textDim, align: 'center', lineSpacing: 5,
    }).setOrigin(0.5);

    this.circle = this.add.circle(W / 2, H / 2 + 10, 62, 0x14142a);
    this.circle.setStrokeStyle(3, COLORS.cyan, 0.8);
    this.pulse = this.add.circle(W / 2, H / 2 + 10, 62, COLORS.cyan, 0.28);

    this.counter = this.add.text(W / 2, H / 2 + 10, '0 / 8', {
      fontFamily: FONT.display, fontSize: '30px', fontStyle: '700', color: CSS.textPrimary,
    }).setOrigin(0.5);

    this.resultText = this.add.text(W / 2, H / 2 + 120, '', {
      fontFamily: FONT.body, fontSize: '18px', color: CSS.hero, align: 'center', lineSpacing: 5,
    }).setOrigin(0.5);

    makeButton(this, {
      x: W / 2, y: H - 58, w: 250, h: 40, label: 'SKIP CALIBRATION',
      color: COLORS.cyan, fontSize: 14, variant: 'secondary', onClick: () => this.finish(0),
    });

    // A bare 120 BPM metronome — no music, nothing to distract from the beat.
    this.bpm = 120;
    this.msPerBeat = 60000 / this.bpm;
    this.startTime = music.currentTime + 1.0;
    this.lastBeat = -1;

    // Pre-schedule every click on the audio clock. An earlier version fired these
    // from update(), which added a frame of jitter to the very measurement that
    // is supposed to be removing latency.
    // Gains: accents on the downbeat (0.5) so the bar stays readable; clicks
    // route through the master bus, so they stay audible at any sfx volume.
    this.totalClicks = 48;
    for (let i = 0; i < this.totalClicks; i++) {
      music.scheduleClick(this.startTime + (i * 60) / this.bpm, i % 4 === 0 ? 0.5 : 0.3);
    }

    this.input.on('pointerdown', this.onTap, this);
  }

  get positionMs() { return (music.currentTime - this.startTime) * 1000; }

  onTap(pointer) {
    if (pointer.y > this.scale.height - 90) return; // let the skip button work
    const pos = this.positionMs;
    if (pos < 0) return;

    const nearest = Math.round(pos / this.msPerBeat);
    const error = pos - nearest * this.msPerBeat;
    if (Math.abs(error) > this.msPerBeat * 0.5) return;

    this.taps.push(error);
    this.counter.setText(`${this.taps.length} / ${this.needed}`);
    this.tweens.add({ targets: this.circle, scale: 1.18, duration: 90, yoyo: true });

    if (this.taps.length >= this.needed) {
      this.input.off('pointerdown', this.onTap, this);
      const sorted = [...this.taps].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length % 2
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
      this.finish(Math.round(median));
    }
  }

  finish(offsetMs) {
    const clamped = Phaser.Math.Clamp(offsetMs, -220, 220);
    saveManager.setSetting('audioOffsetMs', clamped);
    saveManager.setSetting('calibrated', true);
    this.resultText.setText(
      `Offset: ${clamped > 0 ? '+' : ''}${clamped} ms\n` +
      (Math.abs(clamped) > 90
        ? 'That is a large offset — headphones or a wired output will help.'
        : 'Looks good.'));
    // Stop the metronome NOW. The remaining pre-scheduled clicks (up to ~20s
    // worth) would otherwise keep firing over the Menu after the scene switch.
    music.cancelClicks();
    music.sfx('levelup');
    this.time.delayedCall(1400, () => this.scene.start('Menu'));
  }

  update() {
    const pos = this.positionMs;
    if (pos < 0) { this.pulse.setScale(0.2).setAlpha(0); return; }
    const beat = pos / this.msPerBeat;
    const idx = Math.floor(beat);
    this.lastBeat = idx;   // audio is pre-scheduled; this is visuals only
    const phase = beat - idx;
    this.pulse.setScale(0.55 + (1 - phase) * 0.7).setAlpha((1 - phase) * 0.5);
  }
}
