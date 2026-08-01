/**
 * ChartGen — builds a level's note chart procedurally.
 *
 * Charts are deterministic per level (seeded), so a level always plays the same
 * and can be practised. Notes are stored in a lane-agnostic format so BallHop and
 * OsuCircles can both read the exact same data — that abstraction is the whole
 * reason the middle panel is swappable.
 *
 *   note = { beat, lane, hold }    beat is relative to the phrase start
 *
 * Archetypes shape the rhythm, not the density, so difficulty stays predictable:
 *   steady      straight quarters, tutorial-grade
 *   syncopated  off-beat emphasis; punishes counting instead of listening
 *   burst       quiet, then a wall of notes in one bar
 *   chaotic     randomised within the bar; must be read, can't be memorised
 *   silent      a stretch with no lead melody — you play on the drums alone
 */
import { mulberry32 } from './MusicEngine.js';

export const ARCHETYPES = ['steady', 'syncopated', 'burst', 'chaotic', 'silent'];

/**
 * Number of lanes on the track. SINGLE SOURCE OF TRUTH — never hard-code a lane
 * count anywhere else. Chart generation, both minigames, the mirror effect and
 * the tests all read this, so changing it here changes the whole game.
 */
export const LANES = 3;

/**
 * Ball Hop note variants. OsuCircles deliberately ignores the extra field and
 * keeps reading the same lane/timing chart, while BallHop renders the special
 * platform model and owns its interaction state.
 */
export const TILE_KINDS = Object.freeze({
  NORMAL: 'normal',
  TRAP: 'trap',
  BOOST: 'boost',
});

/**
 * Minimum spacing between consecutive notes, in beats.
 *
 * This is a HARD physical constraint, not a taste choice. A tile occupies
 * ±0.05 in depth space and the approach window is 4 beats, so anything closer
 * than 0.4 beats renders as two overlapping slabs — which is exactly the
 * "duplicate tiles" problem. 0.5 also gives the ball time to actually travel.
 */
export const MIN_GAP_BEATS = 0.5;

/**
 * Notes per phrase: 16 at lv1 -> 28 at lv20, over 16 beats.
 *
 * Capped by MIN_GAP_BEATS: 16 beats / 0.5 = 32 notes is the absolute ceiling,
 * so 28 leaves headroom. The old range (24 -> 40) demanded up to 2.5 notes per
 * beat, which is why the generator kept stacking them on top of each other.
 * Enemy HP is derived from this number, so lowering it rebalances automatically.
 *
 * GAME_PLAN B6: Hurry tiers add real density on top of the level curve
 * (tier 2 +15%, tier 3 +30%, still hard-capped at 32 by the minimum gap).
 */
export function notesPerPhrase(level, tier = 1) {
  const base = 16 + (level - 1) * (12 / 19);
  return Math.min(32, Math.round(base * (1 + (tier - 1) * 0.15)));
}

/** Hero/enemy phrase pairs per level: 3 early, 4 mid, 5 late. */
export function phrasePairs(level) {
  return level <= 5 ? 3 : level <= 15 ? 4 : 5;
}

export function archetypeForLevel(level, phraseIndex) {
  const rng = mulberry32(level * 104729 + phraseIndex * 31);
  if (level <= 2) return 'steady';
  const pool = ['steady', 'steady', 'syncopated'];
  if (level >= 5) pool.push('burst');
  if (level >= 8) pool.push('chaotic');
  if (level >= 12) pool.push('chaotic', 'burst');
  if (level >= 14) pool.push('silent');
  return pool[Math.floor(rng() * pool.length)];
}

/**
 * Build the RHYTHM for a phrase: a strictly increasing list of beat positions.
 *
 * Generated as a sequence of GAPS rather than absolute positions, because that
 * makes MIN_GAP_BEATS true by construction. The old version placed notes at
 * absolute positions and deduplicated only on an exact (beat, lane) match, so
 * two notes 0.25 beats apart — or worse, on the same beat in different lanes —
 * sailed straight through.
 *
 * The result is monophonic for scoreable notes: exactly one target at any
 * moment. Trap hazards are the one deliberate exception. A trap is paired with
 * a safe normal tile on another lane at the same beat, so the player always
 * has a target to hit while the hazard remains avoidable.
 */
function buildTimes(archetype, totalBeats, target, rng) {
  const avgGap = Math.max(MIN_GAP_BEATS, totalBeats / target);
  const times = [];
  let t = 0;
  let i = 0;

  while (t < totalBeats - 0.01) {
    times.push(+t.toFixed(4));

    let gap;
    switch (archetype) {
      case 'steady':
        gap = avgGap;
        break;
      case 'syncopated':
        // Alternating long/short gives the off-beat push without stacking notes.
        gap = avgGap * (i % 2 === 0 ? 0.75 : 1.25);
        break;
      case 'burst':
        // Three quick, then a breath. Still never tighter than the minimum.
        gap = (i % 5 < 3) ? avgGap * 0.65 : avgGap * 1.9;
        break;
      case 'chaotic':
        gap = avgGap * (0.6 + rng() * 0.95);
        break;
      case 'silent':
      default:
        gap = avgGap;
        break;
    }

    // Quantise to 16th notes so everything stays musically on-grid, then clamp.
    gap = Math.max(MIN_GAP_BEATS, Math.round(gap * 4) / 4);
    t += gap;
    i++;
  }
  return times;
}

/**
 * Assign a lane to each note so the tiles form a WALKABLE PATH.
 *
 * Two rules:
 *  1. Reachability — the ball needs time to travel. A two-lane jump inside half
 *     a beat is not playable, so the allowed jump scales with the gap.
 *  2. Runs — repeating a lane a few times reads as a path rather than random
 *     scatter, and matches how these games actually look.
 */
function assignLanes(times, rng, { maxJumpCap = LANES - 1, holdChance = 0.30 } = {}) {
  const lanes = [];
  let lane = Math.floor(rng() * LANES);
  let dir = rng() < 0.5 ? -1 : 1;

  for (let i = 0; i < times.length; i++) {
    if (i > 0) {
      const gap = times[i] - times[i - 1];
      // How far the ball can realistically travel in that gap.
      const maxJump = Math.min(maxJumpCap, gap >= 1.0 ? LANES - 1 : gap >= 0.75 ? 2 : 1);

      if (rng() < holdChance) {
        // hold this lane — creates the short "runs" seen in the reference art
      } else {
        let step = Math.min(maxJump, rng() < 0.72 ? 1 : 2);
        let next = lane + dir * step;
        if (next < 0 || next > LANES - 1) {
          dir *= -1;                       // bounce off the edge of the track
          next = lane + dir * step;
        }
        lane = Math.max(0, Math.min(LANES - 1, next));
      }
    }
    lanes.push(lane);
  }
  return lanes;
}

/**
 * Add sparse, deterministic platform variants without making the chart harder
 * to read by stacking hazards. Boost keeps the normal lane and beat rules; a
 * Trap adds one explicit safe partner on a different lane at the same beat.
 * Variants begin after the tutorial levels and remain a Ball Hop-only concern;
 * Osu keeps its original circle presentation at level 11+.
 */
function assignKinds(times, level, rng) {
  const kinds = times.map(() => TILE_KINDS.NORMAL);
  if (level < 3 || level > 10) return kinds;

  // Boosts are a reward state, not the default rhythm. Keep them rare enough
  // that a clean streak feels earned and the normal lane path stays readable.
  const boostChance = Math.min(0.08, 0.05 + Math.max(0, level - 3) * 0.004);
  const trapChance = level >= 4
    ? Math.min(0.14, 0.08 + Math.max(0, level - 4) * 0.008)
    : 0;
  let lastSpecialBeat = -Infinity;

  for (let i = 0; i < times.length; i++) {
    // A special platform gets visual breathing room. This also means a boost
    // never hides the next trap behind its own wider silhouette.
    if (times[i] - lastSpecialBeat < 2.0) continue;
    const roll = rng();
    if (roll < boostChance) {
      kinds[i] = TILE_KINDS.BOOST;
      lastSpecialBeat = times[i];
    } else if (roll < boostChance + trapChance) {
      kinds[i] = TILE_KINDS.TRAP;
      lastSpecialBeat = times[i];
    }
  }
  return kinds;
}

/** Build the note list for one phrase: rhythm first, then the path over it. */
function buildNotes(level, phraseIndex, bars, archetype, seed, tier = 1) {
  const rng = mulberry32(seed);
  const totalBeats = bars * 4;
  const times = buildTimes(archetype, totalBeats, notesPerPhrase(level, tier), rng);
  // GAME_PLAN A2: level 1 is the tutorial — the ball stays on one side of the
  // track, only ever stepping one lane at a time and holding half the time, so
  // the player learns steering before the road starts asking for anything.
  const teaching = level === 1;
  const lanes = assignLanes(times, rng,
    teaching ? { maxJumpCap: 1, holdChance: 0.5 } : {});
  const kinds = assignKinds(times, level, rng);
  const notes = [];

  for (let i = 0; i < times.length; i++) {
    const beat = times[i];
    const safeLane = lanes[i];
    if (kinds[i] !== TILE_KINDS.TRAP) {
      notes.push({ beat, lane: safeLane, hold: 0, kind: kinds[i] });
      continue;
    }

    // A trap is a hazard, never the only tile at a beat. Keep the generated
    // lane as the safe target and place the trap beside it, guaranteeing no
    // same-column duplicate while preserving the original walkable path.
    const trapLane = safeLane === 0
      ? 1
      : safeLane === LANES - 1
        ? LANES - 2
        : (rng() < 0.5 ? safeLane - 1 : safeLane + 1);
    const pairId = `${phraseIndex}:${i}`;
    notes.push({ beat, lane: safeLane, hold: 0, kind: TILE_KINDS.NORMAL,
      trapPair: pairId });
    notes.push({ beat, lane: trapLane, hold: 0, kind: TILE_KINDS.TRAP,
      trapPair: pairId });
  }

  // Draw the safe target first, then the hazard at the same depth.
  return notes.sort((a, b) => a.beat - b.beat || (a.kind === TILE_KINDS.TRAP ? 1 : -1));
}

/**
 * Build the full chart for a level.
 * Phrases alternate: enemy (you defend) -> hero (you attack) -> repeat.
 */
export function generateChart(level, tier = 1) {
  const pairs = phrasePairs(level);
  const bars = 4;
  const phrases = [];
  let cursorBeat = 4; // one bar of lead-in before the first phrase

  for (let p = 0; p < pairs * 2; p++) {
    const type = p % 2 === 0 ? 'enemy' : 'hero';
    const archetype = archetypeForLevel(level, p);
    const seed = level * 7919 + p * 104729 + 17;
    const notes = buildNotes(level, p, bars, archetype, seed, tier);
    phrases.push({
      index: p,
      type,
      archetype,
      bars,
      startBeat: cursorBeat,
      lengthBeats: bars * 4,
      notes,
    });
    cursorBeat += bars * 4;
  }

  return {
    level,
    leadInBeats: 4,
    totalBeats: cursorBeat,
    minigame: level <= 10 ? 'ballhop' : 'osu',
    phrases,
  };
}

/** Total note count for a chart — used to sanity-check balance assumptions. */
export function chartNoteCount(chart) {
  // Trap hazards are visual avoid targets, not scoreable notes. Keep the
  // balance count aligned with the number of normal/Boost landing targets.
  return chart.phrases.reduce((sum, p) =>
    sum + p.notes.filter((n) => n.kind !== TILE_KINDS.TRAP).length, 0);
}
