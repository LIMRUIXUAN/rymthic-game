/**
 * MusicEngine — procedural chiptune generator built on raw Web Audio.
 *
 * WHY GENERATE INSTEAD OF LOADING FILES:
 *   1. Perfect sync. The music is scheduled on the same AudioContext clock the
 *      Conductor reads, so beat 32 in the chart is *exactly* beat 32 in the audio.
 *      With an mp3 you are always fighting encoder lead-in and BPM drift.
 *   2. Zero licensing. Nothing to credit, nothing to get taken down.
 *   3. Zero download. No 3MB per level.
 *   4. Free difficulty scaling. Want level 17 faster and meaner? Change two numbers.
 *
 * Swapping in real music later: keep the Conductor, replace scheduleBeat() with
 * a decoded AudioBuffer source and feed the Conductor ctx.currentTime the same way.
 *
 * Scheduling uses the standard Web Audio lookahead pattern: a JS timer wakes
 * every 25ms and schedules any notes falling inside the next 150ms. Never
 * schedule audio from requestAnimationFrame — frame timing is far too jittery.
 */

const SCHEDULE_AHEAD = 0.15; // seconds of audio scheduled in advance
const TICK_MS = 25;

// Scale degrees (semitone offsets from root) — minor scales read as "battle music"
const SCALES = {
  minor:      [0, 2, 3, 5, 7, 8, 10],
  harmonic:   [0, 2, 3, 5, 7, 8, 11],
  phrygian:   [0, 1, 3, 5, 7, 8, 10],
  dorian:     [0, 2, 3, 5, 7, 9, 10],
  pentatonic: [0, 3, 5, 7, 10],
};

/** Deterministic RNG so a given level always sounds the same. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class MusicEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;

    this.bpm = 120;
    this.playing = false;
    this.startTime = 0;
    this._nextBeat = 0;
    this._timer = null;
    this._noiseBuffer = null;

    this.song = null;
    // Calibration clicks scheduled on the audio clock, tracked so they can be
    // cancelled (cancelClicks) — otherwise a re-entered calibration screen
    // layers new clicks on top of the old ones still waiting to fire.
    this._clicks = new Set();
    this.musicVolume = 0.6;
    // GAME_PLAN A1: 0..4. Each layer of combo adds instruments to the
    // arrangement, so a clean streak literally builds the track.
    this.comboLayer = 0;
    // Hit sounds fire ~30 times a phrase. At the old 0.7 they buried the music
    // and became fatiguing fast; they should sit UNDER the track, not over it.
    this.sfxVolume = 0.42;
  }

  /** Must be called from inside a real user gesture (browser autoplay policy). */
  async init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.musicVolume;
    this.musicBus.connect(this.master);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.sfxVolume;
    this.sfxBus.connect(this.master);

    // Pre-render one second of white noise for percussion
    const len = this.ctx.sampleRate;
    this._noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this._noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  get currentTime() { return this.ctx ? this.ctx.currentTime : 0; }
  get secPerBeat() { return 60 / this.bpm; }

  /** Total output latency — matters for judging. Falls back gracefully. */
  get outputLatency() {
    if (!this.ctx) return 0;
    const base = this.ctx.baseLatency || 0;
    const out = this.ctx.outputLatency || 0;
    return base + out;
  }

  setMusicVolume(v) {
    this.musicVolume = v;
    if (this.musicBus) this.musicBus.gain.value = v;
  }

  setSfxVolume(v) {
    this.sfxVolume = v;
    if (this.sfxBus) this.sfxBus.gain.value = v;
  }

  /**
   * Build a song definition for a level. Higher levels get faster tempo,
   * denser percussion, darker scales.
   */
  static makeSong(level) {
    const bpm = Math.round(96 + (level - 1) * (84 / 19)); // 96 -> 180
    const scaleNames = Object.keys(SCALES);
    const rng = mulberry32(level * 7919 + 13);
    const scale = level >= 15 ? 'phrygian'
      : level >= 10 ? 'harmonic'
      : scaleNames[Math.floor(rng() * 3)];
    return {
      level,
      bpm,
      root: 45 + ((level * 5) % 12),     // wander the key per level
      scale,
      seed: level * 2654435761,
      intensity: Math.min(1, 0.35 + level * 0.045),
    };
  }

  /** Start a song. Resets the clock to beat 0 at this exact audio timestamp. */
  start(song) {
    this.stop();
    this.song = song;
    this.bpm = song.bpm;
    this.rng = mulberry32(song.seed);
    // Small lead-in so the first beat isn't scheduled in the past
    this.startTime = this.ctx.currentTime + 0.12;
    this._nextBeat = 0;
    this.playing = true;
    this._timer = setInterval(() => this._scheduler(), TICK_MS);
    this._scheduler();
  }

  stop() {
    this.playing = false;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  /** Beat position of the audio playhead. Fractional. Can be negative during lead-in. */
  get beatPosition() {
    if (!this.playing) return 0;
    return (this.ctx.currentTime - this.startTime) / this.secPerBeat;
  }

  /**
   * Combo-driven arrangement layering (GAME_PLAN A1), clamped 0..4.
   *
   * The scheduler raises the effective intensity with the layer, so more
   * consecutive hits = fuller instrumentation. A miss drops it back to 0.
   */
  setComboLayer(n) {
    this.comboLayer = Math.max(0, Math.min(4, n | 0));
  }

  _scheduler() {
    if (!this.playing) return;
    const horizon = this.ctx.currentTime + SCHEDULE_AHEAD;
    while (this.startTime + this._nextBeat * this.secPerBeat < horizon) {
      this._scheduleBeat(this._nextBeat, this.startTime + this._nextBeat * this.secPerBeat);
      this._nextBeat++;
    }
  }

  // ---------------------------------------------------------------- instruments

  _kick(t, gain = 1) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
    g.gain.setValueAtTime(0.9 * gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g); g.connect(this.musicBus);
    o.start(t); o.stop(t + 0.24);
  }

  _snare(t, gain = 1) {
    const n = this.ctx.createBufferSource();
    n.buffer = this._noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5 * gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    n.connect(bp); bp.connect(g); g.connect(this.musicBus);
    n.start(t); n.stop(t + 0.18);
  }

  _hat(t, open = false, gain = 1) {
    const n = this.ctx.createBufferSource();
    n.buffer = this._noiseBuffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 7500;
    const g = this.ctx.createGain();
    const dur = open ? 0.16 : 0.045;
    g.gain.setValueAtTime(0.22 * gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(hp); hp.connect(g); g.connect(this.musicBus);
    n.start(t); n.stop(t + dur + 0.02);
  }

  _tone(t, midi, dur, { type = 'square', gain = 0.2, cutoff = 0, detune = 0 } = {}) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = midiToFreq(midi);
    if (detune) o.detune.value = detune;

    let node = o;
    if (cutoff) {
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(cutoff, t);
      lp.frequency.exponentialRampToValueAtTime(Math.max(200, cutoff * 0.35), t + dur);
      o.connect(lp); node = lp;
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    node.connect(g); g.connect(this.musicBus);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // ---------------------------------------------------------------- arrangement

  _scheduleBeat(beat, t) {
    const s = this.song;
    if (!s) return;
    const scale = SCALES[s.scale] || SCALES.minor;
    // Intensity rises with the level AND with the combo layer (A1): a player
    // holding a streak hears the drums thicken, then the lead come in.
    const inten = Math.min(1, s.intensity + this.comboLayer * 0.18);
    const bar = Math.floor(beat / 4);
    const inBar = beat % 4;
    const section = Math.floor(bar / 4) % 4; // 16-beat sections

    // --- drums -------------------------------------------------------------
    if (inBar === 0) this._kick(t, 1.0);
    if (inBar === 2) this._kick(t, 0.85);
    if (inten > 0.55 && inBar === 3 && section % 2 === 1) {
      this._kick(t + this.secPerBeat * 0.5, 0.6);
    }
    if (inBar === 1 || inBar === 3) this._snare(t, 0.9);

    // hats: 8ths early game, 16ths once things get intense
    const div = inten > 0.6 ? 4 : 2;
    for (let i = 0; i < div; i++) {
      this._hat(t + (i * this.secPerBeat) / div, i === 0 && inBar === 2, 0.8 - i * 0.06);
    }

    // fill at the end of every 4th bar
    if (inBar === 3 && bar % 4 === 3) {
      for (let i = 0; i < 4; i++) {
        this._snare(t + (i * this.secPerBeat) / 4, 0.35 + i * 0.13);
      }
    }

    // --- bass --------------------------------------------------------------
    const chordRoots = [0, 5, 3, 7];
    const deg = chordRoots[section];
    const bassMidi = s.root - 12 + scale[deg % scale.length];
    if (inBar === 0 || inBar === 2) {
      this._tone(t, bassMidi, this.secPerBeat * 0.9,
        { type: 'sawtooth', gain: 0.26, cutoff: 420 + inten * 500 });
    }
    if (inten > 0.5 && inBar === 3) {
      this._tone(t + this.secPerBeat * 0.5, bassMidi + 12, this.secPerBeat * 0.35,
        { type: 'square', gain: 0.16, cutoff: 900 });
    }

    // --- lead --------------------------------------------------------------
    // Deterministic arpeggio: same level always plays the same melody.
    const r = mulberry32(s.seed + beat * 2654435761);
    if (r() < 0.35 + inten * 0.4) {
      const steps = inten > 0.65 ? 4 : 2;
      for (let i = 0; i < steps; i++) {
        if (r() < 0.55) continue;
        const octave = r() < 0.25 ? 12 : 0;
        const note = s.root + 12 + scale[Math.floor(r() * scale.length)] + octave;
        this._tone(t + (i * this.secPerBeat) / steps, note, this.secPerBeat / steps * 0.85,
          { type: 'square', gain: 0.11, cutoff: 2600, detune: 4 });
      }
    }
  }

  // ---------------------------------------------------------------- sfx

  _blip(freqStart, freqEnd, dur, type, gain) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freqStart, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
    // Soft attack rather than an instant jump. A hard edge is what makes a short
    // blip read as a "click" instead of a note.
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + dur + 0.01);
  }

  /**
   * Play a note taken from the CURRENT SONG'S KEY AND SCALE.
   *
   * This is the whole trick behind the hit sounds not being noise. A fixed
   * 1400Hz square-wave sweep is dissonant against whatever the music happens to
   * be playing, and at ~30 notes per phrase that dissonance is relentless. A
   * note drawn from the same scale just sounds like part of the song.
   *
   * @param degree scale degree above the root; may exceed the scale length, in
   *               which case it wraps and climbs an octave
   */
  _scaleTone(degree, { dur = 0.26, gain = 0.14, type = 'triangle', octave = 2, cutoff = 3200 } = {}) {
    if (!this.ctx) return;
    const scale = SCALES[this.song?.scale] || SCALES.pentatonic;
    const root = this.song?.root ?? 57;

    const idx = ((degree % scale.length) + scale.length) % scale.length;
    const oct = Math.floor(degree / scale.length);
    const midi = root + scale[idx] + (octave + oct) * 12;

    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const lp = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();

    o.type = type;
    o.frequency.value = midiToFreq(midi);
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;     // shave off the harsh upper harmonics
    lp.Q.value = 0.5;

    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.010);   // gentle attack
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);   // long soft tail

    o.connect(lp); lp.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + dur + 0.02);
  }

  /**
   * Hit feedback. Pitch climbs the scale with your combo, so a clean streak
   * plays an ascending melody over the backing track instead of the same
   * piercing beep thirty times a phrase.
   */
  hit(judgment, combo = 0) {
    if (!this.ctx) return;
    // One scale degree per 4 notes of combo, wrapping after ~2 octaves so it
    // never climbs into ear-splitting territory.
    const step = Math.floor(combo / 4) % 14;

    switch (judgment) {
      case 'PERFECT':
        this._scaleTone(step, { gain: 0.11, dur: 0.30, type: 'triangle', octave: 2 });
        // faint octave shimmer — quiet enough to feel rather than hear
        this._scaleTone(step, { gain: 0.032, dur: 0.22, type: 'sine', octave: 3, cutoff: 5000 });
        break;
      case 'GREAT':
        this._scaleTone(step, { gain: 0.085, dur: 0.24, type: 'triangle', octave: 2 });
        break;
      case 'GOOD':
        this._scaleTone(Math.max(0, step - 1),
          { gain: 0.055, dur: 0.20, type: 'sine', octave: 2, cutoff: 1600 });
        break;
      case 'MISS':
      default:
        // A soft low thud, deliberately NOT a harsh sweep. A miss should feel
        // like the music stumbling, not like being buzzed at.
        this._blip(180, 96, 0.16, 'sine', 0.12);
        break;
    }
  }

  /**
   * Schedule a metronome click at an EXACT audio-clock time.
   *
   * The calibration screen must use this rather than sfx('metronome') from the
   * frame loop. A frame-timed click carries up to a full frame of jitter (~16ms
   * at 60fps, worse under load), and that jitter lands directly in the offset
   * measurement — the tool meant to remove latency would be adding its own.
   *
   * Clicks route to the master bus, NOT the sfx bus: calibration is a system
   * measurement, so it must stay audible no matter what effect volume the
   * player configured. Every scheduled click is tracked and can be silenced
   * early with cancelClicks() — call it when leaving the calibration screen,
   * otherwise the remaining clicks keep firing over the next scene.
   *
   * @param atTime exact audio-clock time (music.currentTime) to sound the click
   * @param gain   peak gain; 0.3 is clearly audible at master volume
   */
  scheduleClick(atTime, gain = 0.3) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const lp = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    o.type = 'triangle';                 // softer than square, still crisp
    o.frequency.setValueAtTime(1200, atTime);
    lp.type = 'lowpass';
    lp.frequency.value = 4000;
    g.gain.setValueAtTime(0.0001, atTime);
    g.gain.exponentialRampToValueAtTime(gain, atTime + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, atTime + 0.05);
    o.connect(lp); lp.connect(g); g.connect(this.master);
    this._clicks.add(o);
    o.onended = () => this._clicks.delete(o);
    o.start(atTime); o.stop(atTime + 0.06);
  }

  /**
   * Immediately silence every click scheduled by scheduleClick(), including
   * ones whose start time is still in the future. Safe to call any time; nodes
   * that already finished are simply skipped. Used by the calibration screen
   * on entry (defensive) and on exit (so the metronome does not keep playing
   * over the Menu).
   */
  cancelClicks() {
    this._clicks.forEach((o) => {
      try { o.stop(); } catch { /* already stopped or not started — fine */ }
    });
    this._clicks.clear();
  }

  sfx(name) {
    if (!this.ctx) return;
    switch (name) {
      // Judgment sounds route through hit(); these remain for callers that
      // do not know the current combo.
      case 'perfect': this.hit('PERFECT'); break;
      case 'great':   this.hit('GREAT'); break;
      case 'good':    this.hit('GOOD'); break;
      case 'miss':    this.hit('MISS'); break;

      case 'hit':     this._blip(420, 150, 0.12, 'triangle', 0.13); break;
      case 'hurt':    this._blip(250, 78, 0.24, 'triangle', 0.18); break;
      case 'skill':
        this._scaleTone(4, { gain: 0.12, dur: 0.34, type: 'triangle' });
        this._scaleTone(7, { gain: 0.08, dur: 0.42, type: 'sine' });
        break;
      case 'heal':
        this._scaleTone(2, { gain: 0.10, dur: 0.40, type: 'sine' });
        this._scaleTone(4, { gain: 0.07, dur: 0.46, type: 'sine' });
        break;
      case 'ui':      this._blip(720, 880, 0.05, 'triangle', 0.08); break;

      // Mode gates. Both are chords in the song's own key so the handoff lands
      // as a musical resolution rather than an alarm: the enemy gate falls to a
      // dark low interval, the hero gate opens upward.
      case 'gateEnemy':
        this._scaleTone(0, { gain: 0.13, dur: 0.5, type: 'triangle', octave: 1, cutoff: 1400 });
        this._scaleTone(3, { gain: 0.09, dur: 0.45, type: 'sine', octave: 1, cutoff: 1200 });
        break;
      case 'gateHero':
        this._scaleTone(4, { gain: 0.12, dur: 0.45, type: 'triangle', octave: 2 });
        this._scaleTone(7, { gain: 0.09, dur: 0.5, type: 'sine', octave: 2 });
        break;
      case 'levelup':
        // A little arpeggio up the song's own scale.
        [0, 95, 190, 310].forEach((ms, i) =>
          setTimeout(() => this._scaleTone(i * 2, { gain: 0.11, dur: 0.34 }), ms));
        break;
      case 'death':
        [0, 145, 290].forEach((ms, i) =>
          setTimeout(() => this._scaleTone(4 - i * 2,
            { gain: 0.12, dur: 0.5, type: 'sine', octave: 1 }), ms));
        break;
      case 'metronome': this._blip(1200, 1200, 0.045, 'triangle', 0.20); break;
      case 'tick':
        // GAME_PLAN A3: soft approach cue as a tile enters its final beat.
        // Deliberately a whisper — it must help, never distract.
        this._blip(920, 720, 0.035, 'triangle', 0.05);
        break;
      case 'milestone':
        // DESIGN §6.3: every 25 combo — a bright two-note lift in the song's key.
        this._scaleTone(7, { gain: 0.12, dur: 0.30, type: 'triangle', octave: 2 });
        this._scaleTone(11, { gain: 0.10, dur: 0.40, type: 'sine', octave: 2 });
        break;
      case 'comboBreak':
        // DESIGN §6.3: a soft low thud — the music stumbling, not a buzzer.
        this._blip(150, 70, 0.20, 'sine', 0.13);
        break;
      case 'shield':
        // GAME_PLAN C9: the phrase's first miss was absorbed — a warm two-note
        // "ding" in the song's key, distinctly kinder than the hurt thud.
        this._scaleTone(4, { gain: 0.11, dur: 0.28, type: 'triangle', octave: 2 });
        this._scaleTone(7, { gain: 0.09, dur: 0.38, type: 'sine', octave: 2 });
        break;
      case 'trap':
        // A clipped low pulse makes the caught state audible without becoming a
        // second judgment sound. The escape meter supplies the visual rhythm.
        this._blip(180, 96, 0.18, 'sawtooth', 0.10);
        break;
      case 'boost':
        // The Boost platform opens upward, matching the rush camera and the
        // lens-shaped reward burst.
        this._scaleTone(7, { gain: 0.12, dur: 0.22, type: 'triangle', octave: 2 });
        this._scaleTone(11, { gain: 0.09, dur: 0.34, type: 'sine', octave: 2 });
        break;
      case 'lens':
        this._blip(860, 1240, 0.08, 'sine', 0.08);
        break;
      default: break;
    }
  }
}

export const music = new MusicEngine();
export { SCALES, mulberry32 };
