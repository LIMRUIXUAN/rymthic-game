# RYTHMIC — Game Design & Technical Spec

**Genre:** Rhythm roguelike / battle-by-beat
**Engine:** Phaser 4 (v4.1.0+) + Vite
**Platform:** Desktop browser, mouse only
**Run structure:** Linear levels 1→20, permadeath, meta-progression between runs
**Status:** Design phase — no code yet

---

## 1. One-line pitch

The enemy sets the tempo. You answer with your mouse. Miss the beat and you bleed; nail it and the beat becomes a weapon.

---

## 2. The core loop

```
Menu → Calibration (once) → LEVEL n
   ├─ Song starts. Enemy and hero alternate PHRASES (8 bars each).
   │    ENEMY PHRASE → enemy sings/attacks → you must hit the notes to BLOCK
   │    HERO PHRASE  → you free-play → accuracy becomes DAMAGE
   ├─ Skills castable any time (mana cost)
   ├─ Enemy HP hits 0 → level clear
   └─ Hero HP hits 0 → RUN OVER (permadeath) → keep Shards → new run
→ UPGRADE screen (3 stat points, 1 skill offer, sometimes a pet)
→ LEVEL n+1
```

A level is one song. The song length *is* the fight length. If you can't kill the enemy before the song ends, the fight goes to **Sudden Death**: a 16-bar overtime where all damage — yours and theirs — is tripled.

### Why phrases, not free-for-all

This is what makes it read as *Friday Night Funkin'* instead of generic osu. The enemy performs, you respond. The alternation gives the fight a call-and-response shape and gives the enemy sprite a reason to animate.

| Phrase type | Who acts | Your job | Failure cost |
|---|---|---|---|
| **Enemy phrase** (defense) | Enemy sprite plays `cast`/`attack` anim, notes stream from left | Hit every note to block | Each unblocked note = damage to you |
| **Hero phrase** (attack) | Hero sprite plays `sing`, notes are yours | Hit notes, hold combo | Low accuracy = weak attack |
| **Perfect block bonus** | — | ≥95% accuracy on an enemy phrase | Free **counter-attack** at 50% attack power |

That counter-attack is your "if extra can attack back."

---

## 3. Screen layout — three panels

```
┌──────────────┬────────────────────────────────┬──────────────┐
│  ENEMY (25%) │        STAGE (45%)             │  HERO (30%)  │
│              │                                │              │
│  [sprite]    │   ← the swappable minigame →   │  HP ▓▓▓▓░░░  │
│   idle/      │                                │  MP ▓▓▓░░░░  │
│   windup/    │   Ball Hop (lv 1–10)           │              │
│   attack/    │   Osu Circles (lv 11–20)       │  [hero art]  │
│   hurt/      │                                │  [pet art]   │
│   cast/      │   ┌──────────────────┐         │              │
│   death      │   │  ACCURACY  94.2% │         │  SKILLS      │
│              │   │  COMBO ×2.75     │         │  [1][2][3]   │
│  HP ▓▓▓▓▓░░  │   │  JUDGE: PERFECT! │         │  [4][5][6]   │
│  "THE MIXER" │   └──────────────────┘         │  [7][8][9]   │
│  BPM 136     │                                │  [10]        │
└──────────────┴────────────────────────────────┴──────────────┘
                     PHRASE 3/8  ●○○●○○○○   [SUDDEN DEATH IN 0:42]
```

The three panels are **not** decoration — each owns a system:

- **Left = threat.** Enemy sprite, HP bar, current BPM, active enemy skill icon, an incoming-attack telegraph that flashes 2 beats before a hard section.
- **Middle = skill expression.** The only place you actually play. Everything else is state.
- **Right = your build.** HP/MP bars, hero sprite, pet, and the 10 skill slots. Skills are clicked here, so your mouse has to leave the play area — a deliberate cost. Skills also bind to number keys as a mercy option (configurable).

---

## 4. Combat math

All numbers below are **verified by simulation** (see §11 for the balance table).

### 4.1 Judgments

Notes are judged on a timing window measured against the audio clock:

| Judgment | Window | Accuracy weight | Combo | Mana |
|---|---|---|---|---|
| **PERFECT** | ±45 ms | 1.00 | +1 | +1.0 |
| **GREAT** | ±90 ms | 0.75 | +1 | +0.6 |
| **GOOD** | ±135 ms | 0.40 | +1 | +0.2 |
| **MISS** | outside / no input | 0.00 | reset | 0 |

Windows shrink by 15% per difficulty tier (see `Hurry`).

### 4.2 Multipliers

```
COMBO_MULT = min(4.0, 1.0 + floor(combo / 25) × 0.25)
PET_MULT   = 1.00 … 1.60   (pet species + pet level)

DIFF_ATK   = 1.0 Chill | 1.30 Normal | 1.60 Hurry | 2.00 Frenzy   ← your damage
DIFF_RISK  = 1.0 Chill | 1.45 Normal | 2.00 Hurry | 2.80 Frenzy   ← damage you take
```

> **Difficulty must be asymmetric.** My first pass used a single `DIFF_MULT` for both directions — that was a bug. With one shared multiplier, offense-per-unit-of-risk stays *constant* across tiers, so a skilled player who can hold accuracy makes Frenzy strictly better: same risk ratio, faster kill, less total damage taken. Nobody would ever play below max difficulty.
>
> Splitting into `DIFF_ATK` and `DIFF_RISK` fixes it. Offense-per-risk at 90% accuracy now **falls** as you climb: Chill 9.00 → Normal 8.07 → Hurry 7.20 → Frenzy 6.43. Cranking `Hurry` is a real gamble that pays only if your accuracy holds up under the tighter windows.

### 4.3 Damage you deal — per note, not per phrase

Damage pops on every single hit. This is the juice.

```
dmgPerNote = ATK × 0.25 × judgeWeight × COMBO_MULT × PET_MULT × DIFF_ATK × (1 − enemyDEF/(enemyDEF+100))
```

### 4.4 Damage you take — per missed note

```
dmgPerMiss = enemyATK × 0.10 × DIFF_RISK × (1 − heroDEF/(heroDEF+100))
```

The `DEF/(DEF+100)` curve gives diminishing returns, so dumping every point into defense caps out around 50% reduction instead of making you immortal.

### 4.5 Mana

```
manaGain (per phrase) = 4 + 10 × ACCURACY²
```

Squaring accuracy means sloppy play starves you of skills exactly when you need them. Mana **carries between levels** and only refills 50% on level clear — so spamming skills in level 12 leaves you dry for the level 15 boss. Scarcity is the point.

### 4.6 Stat points

3 points per level-up, 57 total across a full run.

| Stat | Per point | Base |
|---|---|---|
| **HP** | +12 max HP | 100 |
| **Mana** | +5 max mana, +0.2/s regen | 30 |
| **Defense** | +4 DEF | 0 |
| **Attack** | +3 ATK | 20 |

---

## 5. Skills — 24 in the pool, carry 10

You are **offered 2 random skills** on each upgrade screen and pick one or skip. Once 10 slots are full, taking an 11th forces you to drop one. Skipping grants +1 stat point, so "no skill" is a real choice.

**A = active (costs mana) · P = passive · T = toggle**

### Your three, fully specced

| # | Skill | Type | Cost | Effect |
|---|---|---|---|---|
| 1 | **Respawn Area** | A | 20 | Drains **15% of current HP from both** enemy and hero, simultaneously. A pure equalizer — brutal when you're ahead on HP, suicidal when behind. |
| 2 | **Respawn Happier** | P | — | *Combo skill.* While `Respawn Area` is equipped, its self-damage becomes **healing** instead. Also converts the first 30 damage you take each phrase into healing. Useless alone — the game shows a ⛓ link icon when both are equipped. |
| 3 | **Hurry** | T | 10/tier | Steps difficulty up one tier (Normal→Hurry→Frenzy). Chart scroll speed and note density rise, timing windows shrink 15%. Your damage rises via `DIFF_ATK`, incoming damage rises **faster** via `DIFF_RISK` — see §4.2. Toggle down freely, but the enemy keeps its buff until end of phrase. |

### The rest of the pool

| # | Skill | Type | Cost | Effect |
|---|---|---|---|---|
| 4 | **Metronome Heart** | P | — | Every 32 consecutive PERFECTs, heal 8% max HP |
| 5 | **Second Wind** | P | — | Once per run: survive lethal damage at 1 HP, 3s invulnerable |
| 6 | **Ghost Note** | A | 15 | Next 8 misses count as GOOD instead of MISS |
| 7 | **Mirror Shield** | A | 25 | For one enemy phrase, 40% of blocked damage reflects back |
| 8 | **Overclock** | A | 30 | Combo multiplier climbs at double rate for 16 bars |
| 9 | **Vampire Beat** | P | — | Heal 8% of all damage you deal |
| 10 | **Silence** | A | 35 | Disable enemy skills for 2 phrases |
| 11 | **Half Time** | A | 40 | Chart slows to 0.7× for 8 bars. Your damage also ×0.7. The panic button. |
| 12 | **Double Down** | P | — | PERFECTs deal 2× damage — MISSes deal 2× damage to you |
| 13 | **Pet Feast** | A | 20 | Pet fires its special immediately, ignoring cooldown |
| 14 | **Encore** | A | 50 | Instantly repeat the total damage of your last hero phrase |
| 15 | **Bass Drop** | A | 30 | Charges over 3 phrases, then one hit for **300% ATK ignoring enemy DEF** |
| 16 | **Shield Loop** | P | — | The first miss of every phrase is negated |
| 17 | **Greed Chord** | P | — | +25% stat points on level-up, −15% max HP |
| 18 | **Scavenger** | P | — | +1 mana per enemy note spawned, hit or not |
| 19 | **Tempo Thief** | A | 25 | Steal 10 BPM from the enemy — their phrases slow, yours don't |
| 20 | **Last Stand** | P | — | Below 25% HP, your damage +60% |
| 21 | **Chorus Echo** | P | — | Every 4th PERFECT strikes twice |
| 22 | **Cold Open** | P | — | First phrase of every level has an accuracy floor of 0.6 |
| 23 | **Dissonance** | A | 30 | Scramble the enemy's own chart — their accuracy drops 30% for one phrase |
| 24 | **Soul Trade** | P | — | When mana is empty, skills spend HP instead at 1 HP = 2 mana |

### Intended synergies (the fun part)

| Combo | Why it's strong |
|---|---|
| Respawn Area + **Respawn Happier** | Turns the equalizer into a heal-and-nuke |
| Double Down + **Shield Loop** + Ghost Note | All-in precision build with a safety net |
| Hurry (×3) + **Last Stand** + Second Wind | Frenzy glass cannon — 2.0 diff, +60% damage, one free death |
| Vampire Beat + **Bass Drop** | 300% ignoring DEF also heals 8% — a full-HP swing |
| Greed Chord + **Soul Trade** | Trade your body for stats and casts. Very stupid. Very fun. |
| Scavenger + **Encore** | Build mana off the enemy's own attack, then double your best phrase |

---

## 6. Pets

One pet at a time. Pets give a passive multiplier **and** a beat-timed special on cooldown. They level by eating **Beat Crystals** (earned from S-rank phrases).

| Pet | Mult | Special (every 16 bars) |
|---|---|---|
| **Metro** — metronome slime | +0.10 | Flashes the timing of the next 4 notes |
| **Kicker** — drum beetle | +0.15 | Auto-hits 1 note per phrase as PERFECT |
| **Wisp** — mana moth | +0.05 | +2 mana per 8 bars |
| **Fang** — bass hound | +0.20 | −10% your DEF (glass cannon pet) |
| **Cinder** — fire canary | +0.10 | Burns 2% of enemy max HP per phrase |
| **Echo** — mirror cat | +0.12 | 10% chance to repeat your last damage instance |

Pet levels: L1 base → L5 caps at +0.60 mult on the best pets. Pets are found at levels 3, 8, 13, 18.

---

## 7. Enemies

Every enemy has HP / ATK / DEF / BPM / a **pattern archetype** / and 1–2 **enemy skills**.

### Pattern archetypes

| Archetype | Note behaviour |
|---|---|
| **Steady** | Straight quarter notes. Tutorial-grade. |
| **Syncopated** | Off-beat emphasis, trips people who count instead of listen |
| **Burst** | Long quiet stretches, then 8 notes in one bar |
| **Chaotic** | Randomized within the bar — must read, can't memorize |
| **Silent** | Notes with no audio cue for 2 bars. You play blind. |

### Enemy skills (mirror of yours)

- **Jam** — cuts your sight line from 7.5 beats to 4 (see below)
- **Mirror** — flips the chart left↔right mid-phrase
- **Accelerando** — +15 BPM for the rest of the fight
- **Shield** — +40 DEF for 2 phrases
- **Mend** — heals 10% max HP if you drop below 70% accuracy in a phrase
- **Curse** — your next skill costs double

Bosses (5/10/15/20) get **1.4× ATK, +20 DEF, a unique 3-phase script**, and a phase-change animation where the sprite visibly transforms and the BPM jumps.

#### Jam: a shortened sight line, not a blindfold

`VISIBLE_BEATS` is **7.5** normally and `JAM_REVEAL_BEATS` is **4** while Jam is active. Tiles still arrive fully readable — you simply get roughly half the warning, and the upcoming mode gate is hidden too, so you feel the handoff rather than reading it.

> **Why it changed.** Jam originally hid every note outright. That is not a challenge; it is a blindfold, and there is no skilful response to it — a great player and a poor one both just guess. Cutting reading time instead means good players can still cope and weak ones get punished, which is what a debuff should do.

Osu's approach window (~2.0 beats) is *shorter* than `JAM_REVEAL_BEATS`, so applying that number literally would make Jam a no-op there. Both minigames therefore scale by the **ratio** (`4 / 7.5`), keeping the debuff equally severe whatever the window happens to be.

---

## 8. The middle panel — swappable minigames

The whole point of the middle panel is that it's a **plug-in slot**. Every minigame implements one interface, so combat never knows or cares which game is running.

```js
class MiniGame {
  static id            = 'ballhop';
  static preload(load)                {}   // register assets
  constructor(scene, bounds, conductor, config) {}
  create()                            {}   // build display objects inside bounds
  onPhraseStart(phrase)               {}   // 'enemy' | 'hero', + note list
  onBeat(beatIndex)                   {}   // conductor tick
  update(time, delta)                 {}
  setSpeedTier(tier)                  {}   // Hurry / Frenzy
  getPhraseResult() { return { accuracy, judgments, maxCombo }; }
  destroy()                           {}
}
```

The scene emits `note:judged` events with `{ judgment, deltaMs }`; `CombatResolver` listens and converts them to damage. Adding a third minigame later (slap game, rhythm 2048) means writing one file — nothing in the combat layer changes.

### Ball Hop — levels 1–10

**A 3D-perspective road running to a vanishing point**, in the style of *Music Ball Hop* / *Magic Tiles*. Tiles rush toward the camera along the track; you steer the ball left and right with the mouse so it lands on them. The ball hops on a fixed rhythm — what you control is which lane it is in when the beat lands.

**Mouse movement only. There is never a click.** A test asserts this scene binds `pointermove` and never `pointerdown`, because that constraint is the whole reason this is the level-1 game: someone who has never touched a rhythm game can pass it by following a target with the mouse.

Everything is driven by a single depth value `p` (0 = the ball's plane, 1 = the far edge of the approach window) and one projection:

```
s = 1 / (1 + p × DEPTH)            scale: 1 near, → 0 at the horizon
y = horizonY + (ballY − horizonY) × s
x = cx + laneOffset × s
```

Because x, y *and* size all scale by the same `s`, lanes converge on one vanishing point and tiles draw as **trapezoids** — near edge wider than far edge. That trapezoid is the entire difference between "falling notes" and "a road running into the distance". My first attempt at this screen was a flat top-down lane view, which is a different game entirely.

| Element | Purpose |
|---|---|
| Synthwave backdrop | Sun arc with scanlines, mountain silhouette, converging floor grid — sells depth before a single tile appears |
| Glowing road edges | Pulse on the beat, so the track itself acts as a metronome |
| Landing pad | Marks the judgment plane under the ball, so timing is readable |
| Trapezoid tiles | Drawn far-to-near each frame so nearer tiles correctly overlap distant ones |
| Ball hop + squash | Rises and flattens on the beat; its shadow shrinks as it climbs |

#### Judging: position, never timing

**The player does not control timing here.** The ball hops on its own; the only input is which lane it is in when the beat lands. So the grade is purely positional:

```
distance = |ballLane − tileLane|        in lane units
if distance > 0.5            → MISS
else  positionalError = (distance / 0.5) × 134   → judge()
```

| Offset from tile centre | Grade |
|---|---|
| 0.00 – 0.16 | PERFECT |
| 0.17 – 0.33 | GREAT |
| 0.34 – 0.50 | GOOD |
| > 0.50 | MISS |

> **The bug this replaced.** My first version pasted click-game logic in here: it opened a ±135ms window and resolved on the **first frame inside it**, charging that 135ms as timing error. Getting into the right lane *early* — which is good play — therefore scored GOOD at best, and MISS if you were 0.1 lanes off centre. Symptom: "the cursor is on the tile but it says I missed." Timing windows belong in a clicking game; this is a steering game.

Two supporting rules:

- The ball's closest approach over the **70ms before the beat** is what counts, so a small overshoot right on the beat doesn't erase a clean approach.
- `TILE_W` is *derived* from the hit tolerance (`laneGap × 0.5 × 2 × 0.97`), and a test asserts they stay within 5% of each other. If the drawn tile and the hitbox drift apart, the game is lying to the player about where it can be hit.

#### Mode gates — crossing the handoff instead of cutting to it

At every phrase boundary a **full-width bar spans the entire road**. The ball always passes through it; it cannot be dodged, because it is a transition marker rather than a challenge.

| Gate | Means |
|---|---|
| 🟥 **Red, "DEFEND"** | The enemy's turn is starting — block the incoming notes |
| 🟩 **Green, "ATTACK"** | The floor is yours — accuracy becomes damage |

Crossing it *is* the mode change. On contact: a sheet of light sweeps up the road, the ball flashes the incoming mode's colour, the camera flashes, and a chord plays in the song's own key — falling to a dark low interval for the enemy's turn, opening upward for yours.

> **Why this matters more than it looks.** Before this, the mode simply flipped between phrases with a text banner. The player is mid-flow, watching the track, and the rules silently change under them — by the time you read the word "DEFEND" you have already dropped notes. A gate you watch approach for four beats converts an abrupt cut into a continuous transition, and the colour is readable without reading anything at all.

**The road continues past the gate.** The minigame is handed the *next* phrase as a render-only preview (`setUpcoming`), so tiles keep marching beyond the bar instead of the track stopping dead every 16 beats. Preview tiles take their colour from **their own** phrase, so a red stretch beyond a red gate reads as "the enemy's turn is coming" before you reach it. They are drawn at 75% alpha and are never judged — judging them would resolve a phrase before it began.

> Preview tiles are deliberately *not* mirrored. Mirror is rolled when a phrase actually starts, so it isn't known at preview time.

Three implementation notes worth keeping:

- Gates and note tiles share one `drawSlab()` routine, so they inherit the same perspective and lighting for free. A gate is simply a slab spanning `-0.62 … LANES-1+0.62` instead of one lane.
- **A gate is never replaced until it has been crossed.** Phrase 0 starts a beat *early* so its notes have room to approach, so indexing the gate off `phraseIndex` swapped the opening gate out one beat before the player reached it — it visibly vanished. `updateGate()` therefore advances only once the current gate is spent.

#### Chart generation: one ball, one note at a time

Three constraints are enforced **by construction**, not by filtering afterwards:

| Rule | Why |
|---|---|
| **Monophonic** — exactly one note at any moment | There is one ball and it can only be in one lane. Two tiles landing together makes one of them an unavoidable miss, which reads as the game cheating. |
| **≥ 0.5 beats between notes** (`MIN_GAP_BEATS`) | A tile spans ±0.05 in depth over a 4-beat approach window, so anything closer renders as two overlapping slabs. This is what "duplicate tiles" looked like. |
| **Lane jump ≤ what the gap allows** | The ball has to physically travel. `gap ≥ 1.0` → any lane, `≥ 0.75` → 2 lanes, otherwise 1. |

The generator is split in two: `buildTimes()` produces the rhythm as a sequence of **gaps** (which makes the minimum true automatically), then `assignLanes()` walks a path over those times, bouncing off the edges of the track and occasionally holding a lane to make a short run.

> **What was wrong before.** The old version placed notes at absolute positions and deduplicated only on an exact `(beat, lane)` match. Across all 20 levels that produced **117 simultaneous unhittable notes, 2881 pairs closer than 0.5 beats, and 443 lane jumps too large for the time given**. All three are now zero, asserted by `npm test`.
>
> Note density had to come down to make room: 16→28 per phrase instead of 24→40, since 16 beats at a 0.5 minimum gap only fits 32. Enemy HP is *derived* from note count, so that rebalanced itself.

#### Lane count

The track is **3 lanes**. `LANES` in `src/core/ChartGen.js` is the single source of truth — chart generation, both minigames, the Mirror effect and the tests all read it, so changing that one constant changes the whole game.

Two things are *derived* from it rather than hard-coded, which is what makes it safe to change:

- **Lane spacing.** `laneGap = panelWidth × 0.74 / ((LANES − 1) + 1.24)`, so the road always occupies the same 74% of the panel. With a fixed lane width, dropping to 3 lanes would have rendered a narrow ribbon down the middle with dead space either side.
- **Tile width**, which comes from the hit tolerance, so fewer lanes automatically means chunkier tiles — 142px at 3 lanes versus 108px at 4, much closer to the reference art.

#### Reading the road

Perspective pulls distant tiles toward the centre, so players naturally aim at where a tile *looks* like it is rather than where it will *arrive*. Three things fix that:

| Aid | What it does |
|---|---|
| **Lane highlight** | The ball's own lane is projected as a translucent strip all the way to the horizon |
| **Guide rails** | Each tile within ~0.55 depth drops a line down its lane to the ball plane |
| **Alignment glow** | A tile you're lined up with turns white and gets a target bracket on the road — feedback *before* the beat, not after |

### Osu Circles — levels 11–20

Numbered circles appear with shrinking approach rings. Move the mouse onto the
numbered target and stay over it as the ring meets the circle. There is no click
input. Accuracy = ring-overlap precision.

- Targets use a larger movement-friendly hit circle; PERFECT, GREAT, GOOD, and
  MISS feedback is compact and placed directly below its circle so it never
  obscures the next target. This treatment is Osu-only, Ball Hop keeps its
  runway feedback.
- A connected motion line and directional chevrons show the next jump before it
  arrives; the generated path stays in a tighter central corridor rather than
  scattering targets across the whole panel.
- The route is continuous inside each phrase, but stops cleanly at a mode gate;
  defense red never bridges into attack green, matching standard Osu target
  grouping.
- Sliders: follow the connected motion path with the mouse
- Spinners: circle the mouse rapidly, used as a "charge" for Bass Drop
- Stacked circles for burst archetypes
- On defense phrases the circles are **red** and represent incoming hits

### Difficulty ramp inside a minigame

`setSpeedTier` is what `Hurry` calls. Tier raises scroll speed, note density, and shrinks judgment windows — it does **not** change BPM (the song stays the same, which keeps the audio sync intact).

---

## 9. Technical architecture (Phaser 4 + Vite)

### 9.0 Why Phaser 4, not 3

Phaser 4.0 shipped 10 April 2026; **4.1.0 is the current stable release (30 April 2026)**. For a project that hasn't written a line yet, starting on 3 means signing up for a migration you never have to do.

What v4 changes, checked against this spec:

| Area this design uses | v4 impact |
|---|---|
| Scenes, sprites, text, groups, input, tweens, audio, arcade physics | **Unchanged.** The entire core loop, Conductor, and panel system port as-is. |
| Spritesheet animations (enemy `idle`/`attack`/`hurt`/`death`) | Unchanged |
| Boss-phase chromatic aberration (§9.5) | **Easier.** v3's split FX/mask systems are unified into one filter system that works on any game object *or camera* — so a full-screen boss-phase distortion is now a camera filter instead of a custom pipeline. |
| Custom WebGL pipelines | Rewritten as **render nodes** — but this design doesn't need any |

Gotchas to set at project creation, so they never bite you:

- **`roundPixels` now defaults to `false`.** If you go with pixel-art sprites, set it explicitly to `true` in the game config or everything will look subtly blurry.
- `Math.TAU` is now correctly `PI × 2` (v3 had it wrong at `PI / 2`). Use `Math.PI_OVER_2` if you want the old value.
- `Geom.Point`, `Mesh`, `Plane`, and `BitmapMask` are gone. None are used here.
- `Phaser.Struct.Set`/`Map` are now native JS `Set`/`Map`.
- `DynamicTexture` needs an explicit `.render()` call — relevant if you pre-render note graphics to a texture atlas at boot.

**The honest trade-off:** most tutorials, StackOverflow answers, and community plugins you'll find are still written for v3. The public API is close enough that v3 tutorials mostly translate, and Phaser is publishing v4 material now — but expect to occasionally hit a v3 snippet that needs a small fix. Worth it to not carry migration debt on a project this size.

### 9.1 The Conductor — the single most important class

Rhythm games live or die on audio sync. Rule: **never use `delta` as the beat clock.** Frame time drifts against audio within seconds.

The audio system is **unchanged between v3 and v4** — it isn't in the migration guide's breaking-change list at all. `sound.seek`, `AudioContext` suspend/resume behaviour, and the whole approach below carry over untouched.

```js
// Conductor.js — audio playback position is the master clock
get songPositionMs() {
  const raw = this.sound.seek * 1000;                  // Web Audio truth
  const interp = raw + (performance.now() - this._lastSeekAt);
  // seek() only updates a few times per second; interpolate between updates,
  // hard-resync whenever drift exceeds 20ms
  return interp - this.userOffsetMs - this.chartOffsetMs;
}
get beat() { return this.songPositionMs / (60000 / this.bpm); }
```

Three offsets, all separate:
1. `chartOffsetMs` — baked into the chart file, fixes the song's own lead-in
2. `userOffsetMs` — from the calibration screen, saved to localStorage
3. `visualLeadMs` — how early notes spawn so they arrive on time

**Calibration scene runs before level 1 and is mandatory.** Player clicks along to 8 beats of a metronome; median offset is stored. Skipping this is the #1 reason web rhythm games feel broken.

Web Audio starts *suspended* until a user gesture. Phaser resumes the context on first interaction, but the Boot scene must gate "Start" behind a real click, and pause the run when the tab loses focus.

### 9.2 Scene graph

```
BootScene         → config, load bar assets
PreloadScene      → assets for the upcoming level only (don't load 20 songs at once)
MenuScene         → new run / continue / settings
CalibrationScene  → audio offset (first launch, re-runnable from settings)
MapScene          → run progress, level 1..20 nodes, current build summary
LevelScene        → the fight. Owns EnemyPanel / StagePanel / HeroPanel.
UpgradeScene      → 3 stat points, 2 skill offers, pet events
GameOverScene     → run stats, Shards earned, meta unlocks
```

### 9.3 Chart format

```json
{
  "id": "lv01",
  "bpm": 96,
  "offsetMs": 120,
  "audio": "assets/audio/music/lv01.ogg",
  "minigame": "ballhop",
  "phrases": [
    { "type": "enemy", "bars": 8, "archetype": "steady",
      "notes": [[0,1],[1,1],[2,0],[3,2],[4,1,2]] },
    { "type": "hero",  "bars": 8,
      "notes": [[0,0],[0.5,1],[1,2],[1.5,1]] }
  ]
}
```

`note = [beatPosition, lane, holdLengthBeats?]` — lane-agnostic so both minigames read the same file. Ball Hop maps lanes to x-positions; Osu maps lanes to screen regions.

**Chart generation:** hand-authoring 20 charts is the biggest content cost. Build a small offline script that reads a song's onset envelope (Python + `librosa`) and emits a draft chart, then hand-tune. Budget ~2 hours per song for tuning.

### 9.4 Folder structure

```
rymthic_game/
├── index.html
├── package.json
├── vite.config.js
├── src/
│   ├── main.js
│   ├── core/
│   │   ├── Conductor.js         ← audio clock, beat events
│   │   ├── Judge.js             ← timing windows → judgment
│   │   ├── CombatResolver.js    ← judgments → damage, both directions
│   │   ├── RunState.js          ← hp, mana, stats, skills, pet, level
│   │   ├── SkillEngine.js       ← cast, cooldowns, passive hooks
│   │   ├── SaveManager.js       ← localStorage, meta-progression
│   │   └── EventBus.js
│   ├── scenes/                  ← the 8 scenes above
│   ├── panels/
│   │   ├── EnemyPanel.js
│   │   ├── StagePanel.js        ← hosts the active MiniGame
│   │   └── HeroPanel.js
│   ├── minigames/
│   │   ├── MiniGame.js          ← abstract base + registry
│   │   ├── BallHop.js
│   │   └── OsuCircles.js
│   ├── data/
│   │   ├── enemies.js  skills.js  pets.js  levels.js
│   └── charts/  lv01.json … lv20.json
└── public/assets/
    ├── audio/music/   audio/sfx/
    ├── sprites/enemies/  sprites/hero/  sprites/pets/
    └── ui/
```

### 9.5 Enemy 2D motion

Spritesheet animations per enemy: `idle`, `windup`, `attack`, `hurt`, `cast`, `death`.

Cheap trick with huge payoff: **beat-bop everything.** On each beat, tween `scaleY 1.0 → 0.92 → 1.0` over one beat-length on the enemy, hero, pet, and HP bars. Even placeholder rectangles feel alive when they breathe with the music. Do this in week one — it will carry the prototype's feel while art is still missing.

Layer on: screen shake scaled to damage, hit-stop (freeze 40ms on big hits), colour flash on `hurt`, particle burst on death, and a chromatic-aberration pulse on boss phase change — in v4 that's a **camera filter**, not a custom pipeline, since filters now apply to any game object or camera.

### 9.6 Save format

```json
{
  "meta": { "runs": 12, "bestLevel": 14, "shards": 340,
            "unlockedSkills": ["bassdrop"], "unlockedPets": ["echo"] },
  "settings": { "audioOffsetMs": -32, "musicVol": 0.8, "sfxVol": 1.0, "keybinds": true },
  "run": { "level": 7, "hp": 118, "mana": 42, "seed": 918273,
           "stats": {"hp":2,"mana":1,"def":3,"atk":12},
           "skills": ["respawn_area","respawn_happier","hurry"], "pet": {"id":"metro","lvl":2} }
}
```

---

## 10. Permadeath & meta-progression

Die and you lose the run — stats, skills, pet, all of it. You keep **Shards** (earned = level reached × 10 + accuracy bonus). Shards spend on permanent unlocks that widen the *pool*, never raise your power directly:

- Unlock new skills into the offer pool (200–600 shards each)
- Unlock new pets (500 each)
- Unlock starting-loadout slots: begin a run with 1 chosen skill (800)
- Unlock alternate heroes with different base stats (1500)

This is the Slay-the-Spire / Hades rule: meta-progression adds *variety*, not raw stats, so run 50 is still a real fight.

---

## 11. Balance table (simulation-verified)

Assumptions: average build (57 points split evenly), **Normal** difficulty (`DIFF_ATK` 1.30 / `DIFF_RISK` 1.45), **no pet**, average combo multiplier **1.8**. Enemy HP is *derived* from expected player output, not hand-picked — normal enemies at 0.72× expected output, bosses at 0.88×.

> **The assumptions matter more than the formula.** The first version modelled a combo of 2.5 and a pet of ×1.15 — a player who never drops a combo and always has a companion. No pet is even *offered* until level 3, and combo resets on every single miss, so real output ran **28–37% under the model** and every enemy was inflated by exactly that much. Fights dragged. The assumptions are now deliberately conservative: a competent player with no pet and an interrupted combo. Anyone doing better melts the enemy, which is the correct *reward* for playing well rather than the baseline expectation.

| Lv | Enemy | Game | BPM | Notes/ph | Pairs | Enemy HP | ATK | DEF | Kill @90% | HP left @80% | @90% | @95% |
|----|-------|------|-----|----|----|------|-----|-----|------|------|------|------|
| 1 | Tin Drummer | Ball Hop | 96 | 16 | 3 | 360 | 14 | 0 | 140% | 87% | 96% | 100% |
| 2 | Snare Sprite | Ball Hop | 100 | 17 | 3 | 430 | 16 | 3 | 139% | 86% | 96% | 100% |
| 3 | Hi-Hat Harpy | Ball Hop | 105 | 17 | 3 | 470 | 18 | 6 | 140% | 86% | 96% | 100% |
| 4 | Kick Golem | Ball Hop | 109 | 18 | 3 | 490 | 20 | 9 | 138% | 83% | 95% | 100% |
| **5** | **THE CONDUCTOR** | Ball Hop | 114 | 19 | 3 | 580 | 31 | 32 | 114% | 75% | 92% | 100% |
| 6 | Bassline Wraith | Ball Hop | 118 | 19 | 4 | 800 | 25 | 15 | 139% | 77% | 92% | 100% |
| 7 | Loop Fiend | Ball Hop | 123 | 20 | 4 | 900 | 28 | 18 | 139% | 75% | 92% | 100% |
| 8 | Reverb Ghoul | Ball Hop | 127 | 20 | 4 | 880 | 31 | 21 | 138% | 72% | 91% | 100% |
| 9 | Clipping Beast | Ball Hop | 131 | 21 | 4 | 980 | 35 | 24 | 138% | 70% | 90% | 100% |
| **10** | **THE MIXER** | Ball Hop | 136 | 22 | 4 | 1140 | 54 | 47 | 113% | 54% | 84% | 99% |
| 11 | Sine Serpent | Osu | 140 | 22 | 4 | 1130 | 43 | 30 | 139% | 67% | 88% | 99% |
| 12 | Glitch Imp | Osu | 145 | 23 | 4 | 1150 | 49 | 33 | 139% | 61% | 86% | 98% |
| 13 | Sidechain Stalker | Osu | 149 | 24 | 4 | 1260 | 55 | 36 | 139% | 58% | 84% | 98% |
| 14 | Distortion Djinn | Osu | 153 | 24 | 4 | 1310 | 61 | 39 | 139% | 56% | 84% | 98% |
| **15** | **THE PRODUCER** | Osu | 158 | 25 | 4 | 1520 | 96 | 62 | 113% | 33% | 75% | 96% |
| 16 | Null Chorus | Osu | 162 | 25 | 5 | 1730 | 77 | 45 | 139% | 33% | 75% | 96% |
| 17 | Phase Reaper | Osu | 167 | 26 | 5 | 1860 | 86 | 48 | 139% | 28% | 72% | 95% |
| 18 | Silence Warden | Osu | 171 | 27 | 5 | 2000 | 96 | 51 | 139% | 21% | 70% | 94% |
| 19 | Feedback Titan | Osu | 176 | 27 | 5 | 2060 | 108 | 54 | 139% | 18% | 68% | 93% |
| **20** | **THE ENCORE** | Osu | 180 | 28 | 5 | 2270 | 169 | 77 | 114% | -35% | 47% | 88% |

**Difficulty curve as it actually stands:**

| Accuracy | Outcome |
|---|---|
| 80% | Dies to the final boss (level 20) |
| 85% | Clears level 20 on a knife's edge (~6% HP) |
| 90% | Clears level 20 with ~47% HP |
| 95% | Clears comfortably (~88% HP) |

> **GAME_PLAN C9 soft-punishment buffer (2026-07):** the first missed note of
> every phrase is absorbed — no damage, but combo / accuracy / music layers
> still break. This shifted the whole curve right by roughly one accuracy tier:
> the fail line moved from 85% to 80%, and 90% went from a 18%-HP near-loss to
> a 47%-HP clear. This is the *intended* effect, not an accident: the buffer
> exists to forgive one mistake per phrase, and forgiving mistakes is, by
> definition, a difficulty reduction. No coefficient was re-inflated to claw
> the curve back, because the buffer helps high-accuracy players far more than
> low-accuracy ones (a 95% player has most of their few misses absorbed; an
> 80% player still eats 5 of every 6) — compensating via `K_IN` would have
> punished exactly the players the buffer exists to protect. `taken()` in
> balance_sim.py models the buffer with the conservative assumption that
> misses spread evenly across phrases; real play, with combo resets on every
> miss, lands closer to the old curve than this table suggests.

> This is *softer* than the original spec, which had 90% losing the final boss. The cause was the chart rewrite: enforcing a 0.5-beat minimum gap capped notes per phrase at 28 (down from 40), and fewer notes means fewer misses means less incoming damage. I kept the softer curve rather than re-inflating `K_IN` to compensate — "80% fails, 90% narrowly clears, 95% is comfortable" is a cleaner ladder than "90% still loses", and the fight length was the actual complaint. The point is that the doc and the game now agree; a spec that quietly disagrees with the build is worse than no spec.

**What the numbers mean:**

- Normal enemies at 90% accuracy die with **25% of the song to spare** — comfortable but not free.
- Bosses at 90% accuracy die with **~9% to spare** — you must not choke in the last phrase.
- **80% accuracy is the fail line.** You survive to level 14 on 80%, then die at THE PRODUCER (−30%). By level 20 it's −134%. The game teaches you that accuracy, not stats, is the real currency.
- **Level 20 at 90% accuracy is a loss (−17% HP), and a clear at 95% (41% left).** This is deliberate: an average build playing averagely *just* loses the final fight. You close a 17% gap with skills, pet levels, an HP-heavy build, or better play. That gap is the entire justification for the skill system existing — if a neutral build cleared the game, none of §5 would matter.
- Mana income at 90% accuracy runs ~73/level early to ~121/level late, against a max pool of 30→100. That's **3–5 casts per level**. Scarce enough that skill choice is a real decision.

**These are a starting hypothesis, not gospel.** Every number here comes from one spreadsheet-grade model with a fixed 2.5 combo multiplier and no skills active. Real playtesting will break it. Keep the simulation script around and re-run it whenever you change a coefficient.

> **A bug this table caught.** The first version of `tools/balance_sim.py` used Python's `round()`, which does *banker's rounding* — `round(4.5) == 4`. JavaScript's `Math.round(4.5)` is `5`. The stat allocation lands exactly on `.5` at levels 3, 7, 11, 15 and 19, so the simulator and the shipped game silently disagreed by up to 9% enemy HP at levels 7 and 15. `npm test` now asserts the JS enemy-HP curve against this exact table, so the two can never drift apart again. The game is the source of truth; the simulator was corrected to match it.

---

## 12. Music & audio sourcing (all commercial-safe)

**Rule: CC0 or explicitly royalty-free only. Never CC-BY-NC** — that license forbids commercial use, and it will bite you later.

| Source | License | Use for |
|---|---|---|
| **Pixabay Music** | Pixabay Content License — commercial OK, **no attribution** | Primary music source. Easiest legally. |
| **OpenGameArt** (filter CC0) | CC0 | Game-specific loops, chiptune, battle themes |
| **Kenney audio packs** | CC0, no signup | UI clicks, impacts, hit sounds — perfect for note SFX |
| **Freesound** (filter CC0) | Per-file, filter to CC0 | One-off SFX, ambience |
| **Sonniss GDC bundle** | Royalty-free, no attribution | Professional SFX, huge library |
| **Incompetech** (Kevin MacLeod) | CC-BY 4.0 — **attribution required** | Backup music if you keep a credits screen |
| **Free Music Archive** | Mixed — check each track | Last resort only |

### Hit sounds must be *in key*, not just quiet

Judgment sounds fire roughly **30 times a phrase**. That frequency changes the design problem completely: any fixed-frequency blip is dissonant against whatever the music happens to be playing, and at 30 repeats a phrase that dissonance becomes relentless. Turning it down doesn't fix it — it just makes it quieter noise.

The fix is to draw every hit note from **the current song's own root and scale**:

| | Old | New |
|---|---|---|
| Source | Fixed 1400→2400 Hz sweep | Note from the song's key + scale |
| Waveform | Square / sawtooth | Triangle / sine through a lowpass |
| Envelope | Instant attack (reads as a *click*) | 10 ms attack, long soft tail |
| Variation | Identical every hit | Climbs one scale degree per 4 combo |
| Gain | 0.22 | 0.11, and the SFX bus dropped 0.7 → 0.42 |

A clean streak therefore plays an **ascending melody in key over the backing track** rather than the same beep thirty times. A MISS is a soft low thud, not a harsh sweep — it should feel like the music stumbling, not like being buzzed at.

`npm test` asserts every reachable combo step lands on a note that is genuinely in the song's scale, and that the song BPM equals the chart BPM at all 20 levels.

### Practical rules for a rhythm game

1. **You need constant, obvious BPM.** Filter for electronic / chiptune / drum-and-bass. Ambient tracks are unusable — there's no beat to chart.
2. **Get the exact BPM before charting.** If the source doesn't state it, run the file through `librosa.beat.beat_track` or Audacity's beat finder and write it into the chart JSON. A BPM that's off by 0.5 will desync by a full beat within two minutes.
3. **Prefer loops over full songs.** A 30-second loop that seamlessly repeats is easier to chart and lets you extend Sudden Death cleanly.
4. **Encode `.ogg` + `.m4a`.** Phaser needs both for full browser coverage. Keep files under 3 MB.
5. **Keep a `CREDITS.md` from day one** listing every file, its source URL, and license — even for CC0. Reconstructing this later is miserable.

---

## 13. Build roadmap

| Phase | Deliverable | Why this order |
|---|---|---|
| **0 — Skeleton** | Vite + Phaser 4 project (`npm i phaser@^4.1`), `Conductor`, CalibrationScene, a metronome that visibly ticks on beat. Set `roundPixels` in config now. | If sync isn't right, nothing else matters. Prove it first. |
| **1 — Vertical slice** | Ball Hop + 1 enemy + `CombatResolver` + phrase alternation. Placeholder rectangles, one song. | You can *feel* the core loop at the end of this phase. Play it before building anything else. |
| **2 — Shell** | Three panels, HP/MP bars, UpgradeScene, stat points, MapScene, levels 1–5 | Turns a fight into a run |
| **3 — Depth** | SkillEngine + all 24 skills, pets, enemy skills | Where the game becomes replayable |
| **4 — Second act** | Osu Circles minigame, levels 11–20, bosses | Proves the minigame interface actually works. If adding Osu requires touching `CombatResolver`, the abstraction failed — fix it here. |
| **5 — Juice & audio** | Real sprites, beat-bop, hit-stop, screen shake, final music, SFX, credits | Cheapest phase for the biggest "feels good" gain |
| **6 — Meta & balance** | SaveManager, Shards, unlocks, playtest passes, tune the table in §11 | Numbers in §11 are a starting hypothesis, not gospel |

**Biggest risks, in order:**

1. **Audio sync** — mitigated by doing Phase 0 first and shipping mandatory calibration.
2. **Chart authoring time** — 20 songs × ~2h tuning = 40 hours of content work. Build the `librosa` draft-generator early.
3. **Scope on skills** — 24 skills is a lot of edge cases. `SkillEngine` needs clean hooks (`onNoteJudged`, `onPhraseEnd`, `onDamageDealt`, `onDamageTaken`, `onLethal`) or every skill becomes a special case.
4. **Two minigames sharing one chart format** — validate this in Phase 1 by writing a throwaway second minigame that reads the same JSON. Ten minutes of work, saves a rewrite in Phase 4.

---

## 14. Open questions to decide before Phase 1

- Mouse-only is a hard constraint for the minigames, but should **skills** be clickable-only too, or number-key bound? (Clicking pulls the mouse off the play area — that's an interesting cost, but may feel bad at 180 BPM.)
- Does the run end at 20, or does 20 unlock an endless "Encore Mode" with scaling?
- Should the player pick the song, or is song tied to level? (Player-picked songs are great for replay but break the difficulty curve.)
- Sudden Death at 3× damage — or should running out of song just be a loss?

---

*Sources for the audio and sync research are listed in the chat response accompanying this document.*
