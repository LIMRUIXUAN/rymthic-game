/**
 * Bgm — background music for the non-combat scenes (Menu / Upgrade / GameOver).
 *
 * WHY SEPARATE FROM MusicEngine: battle music is synthesized live by
 * MusicEngine (combo layering, sfx, the Conductor clock). BGM is a plain
 * audio file loop on Phaser's SoundManager, deliberately OFF during combat:
 * the Level scene plays the synth battle track and Calibration runs its
 * audio-clock metronome — layering a file on top of either would be the
 * exact "music stacking" the player complained about.
 *
 * Tracks: Kevin MacLeod (incompetech.com), licensed CC BY 4.0 — attribution
 * is shown in the Menu (bottom-left). Pipeline notes in history.md v2.6.
 */
import { saveManager } from './SaveManager.js';

export const BGM_TRACKS = [
  { key: 'bgm_atlantean', file: 'music/Atlantean Twilight.mp3', title: 'Atlantean Twilight' },
  { key: 'bgm_backed',    file: 'music/Backed Vibes.mp3',       title: 'Backed Vibes' },
  { key: 'bgm_8bit',      file: 'music/8bit Dungeon Level.mp3', title: '8bit Dungeon Level' },
];

// Ambience sits a touch under the battle synth track, so it never drowns out
// the UI blips on top of it.
const VOLUME_SCALE = 0.8;

let current = null; // { key, sound }
let lastKey = null; // the track most recently picked — avoid repeats

/** Register every track with the loader. Call from BootScene.preload(). */
export function registerBgm(scene) {
  for (const t of BGM_TRACKS) scene.load.audio(t.key, t.file);
}

/**
 * Start (or keep) menu BGM. Picks a track at random — except the one that
 * played last — and loops it. If a track is already playing (e.g. the player
 * moved Menu → Upgrade) it just stays, so music never restarts mid-mood.
 * Safe to call from any scene; never throws.
 */
export function playMenuBgm(scene) {
  try {
    if (current && current.sound.isPlaying) {
      current.sound.setVolume(bgmVolume());
      return;
    }
    const pool = BGM_TRACKS.filter((t) => t.key !== lastKey);
    const track = pool[Math.floor(Math.random() * pool.length)] || BGM_TRACKS[0];
    lastKey = track.key;
    stopMenuBgm();
    const s = scene.sound.add(track.key, { loop: true, volume: bgmVolume() });
    s.play();
    current = { key: track.key, sound: s };
  } catch (err) {
    // BGM is garnish, not gameplay — a failure must never break a scene.
    console.warn('[bgm] play failed', err);
  }
}

/**
 * Stop menu BGM. MUST be called when entering the Level or Calibration
 * scenes, which own the audio (battle synth / metronome clicks).
 */
export function stopMenuBgm() {
  if (!current) return;
  try {
    current.sound.stop();
    current.sound.destroy();
  } catch { /* already gone */ }
  current = null;
}

function bgmVolume() {
  const v = saveManager.settings.musicVol ?? 0.6;
  return v * VOLUME_SCALE;
}
