import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene.js';
import { CalibrationScene } from './scenes/CalibrationScene.js';
import { MenuScene } from './scenes/MenuScene.js';
import { LevelScene } from './scenes/LevelScene.js';
import { UpgradeScene } from './scenes/UpgradeScene.js';
import { GameOverScene } from './scenes/GameOverScene.js';

const config = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#07070d',
  // Phaser 4 changed this default to false. Our art is vector primitives rather
  // than pixel art, so false is correct here — set it to true if you swap in
  // pixel-art spritesheets, or everything will look subtly soft.
  roundPixels: false,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1440,
    height: 810,
  },
  // No arcade/matter physics: every position in this game is derived from the
  // beat clock, not from simulated motion. Adding a physics step would only
  // introduce a second, competing source of truth about where things are.
  scene: [BootScene, CalibrationScene, MenuScene, UpgradeScene, LevelScene, GameOverScene],
};

const game = new Phaser.Game(config);

// DESIGN §6.6: uniform scene transitions — every scene fades in from black.
game.events.on(Phaser.Scenes.Events.CREATE, (sys) => {
  sys.scene.cameras.main.fadeIn(220, 0, 0, 0);
});

// Exposed so tests/smoke.mjs can inspect live scene state from headless Chrome.
// Harmless in production and genuinely useful for debugging in the console.
window.__game = game;

export default game;
