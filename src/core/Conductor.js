/**
 * Conductor — the beat clock. Everything rhythmic reads from this and nothing else.
 *
 * THE ONE RULE: never derive beat position from frame delta. requestAnimationFrame
 * jitters, drops, and throttles in background tabs. Within 30 seconds a delta-based
 * clock will be a full beat out of sync with the audio and the game will feel broken
 * in a way that is very hard to diagnose.
 *
 * We read AudioContext.currentTime, which is the same hardware clock that is actually
 * pushing samples to the speakers. It cannot drift relative to the music.
 *
 * Two separate offsets, deliberately not merged:
 *   chartOffsetMs  - per-song lead-in correction
 *   outputLatency  - what the browser reports about its own buffer delay
 */
export class Conductor {
  constructor(music) {
    this.music = music;
    this.chartOffsetMs = 0;
    this.useReportedLatency = true;

    this._lastBeatFired = -1;
    this.onBeat = null;   // (beatIndex) => void
    this.onBar = null;    // (barIndex)  => void
  }

  get bpm() { return this.music.bpm; }
  get secPerBeat() { return 60 / this.music.bpm; }
  get msPerBeat() { return 60000 / this.music.bpm; }
  get isPlaying() { return this.music.playing; }

  /** Total correction applied to raw audio position, in milliseconds. */
  get totalOffsetMs() {
    const latency = this.useReportedLatency ? this.music.outputLatency * 1000 : 0;
    return this.chartOffsetMs + latency;
  }

  /** Where the song actually is, in milliseconds, corrected. */
  get songPositionMs() {
    if (!this.music.playing) return 0;
    const raw = (this.music.currentTime - this.music.startTime) * 1000;
    return raw - this.totalOffsetMs;
  }

  /** Fractional beat position. This is what minigames scroll against. */
  get beat() { return this.songPositionMs / this.msPerBeat; }

  /** Absolute time in ms at which a given beat lands (offset-corrected). */
  timeOfBeat(beat) { return beat * this.msPerBeat; }

  /** Signed error in ms between now and a target beat. Negative = you were early. */
  errorToBeat(beat) { return this.songPositionMs - this.timeOfBeat(beat); }

  /** 0..1 progress through the current beat — drives the visual bop. */
  get beatPhase() {
    const b = this.beat;
    return b - Math.floor(b);
  }

  reset() { this._lastBeatFired = -1; }

  /** Call once per frame from the scene. Fires onBeat / onBar exactly once per beat. */
  update() {
    if (!this.music.playing) return;
    const current = Math.floor(this.beat);
    if (current > this._lastBeatFired && current >= 0) {
      // If frames were dropped, don't spam every skipped beat — jump to current.
      this._lastBeatFired = current;
      if (this.onBeat) this.onBeat(current);
      if (current % 4 === 0 && this.onBar) this.onBar(current / 4);
    }
  }
}
