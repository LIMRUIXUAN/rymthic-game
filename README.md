# RYTHMIC

A rhythm roguelike. The enemy sets the tempo; you answer with your mouse.
Built on **Phaser 4.2.1** + Vite. Full design spec in [`GAME_DESIGN.md`](GAME_DESIGN.md).

---

## Run it

```bash
npm install
npm run dev          # opens http://localhost:5173
```

That's the whole setup. **There are no assets to download** — all music, sound
effects, and graphics are generated at runtime.

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm test` | Combat math + skills + charts (33 tests, pure Node) |
| `npm run test:scene` | Panels + minigames under jsdom (20 tests) |
| `npm run test:browser` | Full click-through in headless Chrome (needs `npm i -D puppeteer`; skips cleanly without it) |
| `npm run balance` | Regenerate the balance table |

---

## How to play

1. **Calibrate first.** Eight clicks on the beat. This measures your hardware's
   audio delay. Skipping it is the usual reason a browser rhythm game "feels off".
2. Spend stat points, take a skill (or skip for +1 point instead).
3. Fight. Phrases alternate:
   - **DEFEND** (red notes) — hit them to block. Every note you miss hurts you.
   - **ATTACK** (green notes) — accuracy becomes damage.
   - Block a whole phrase at **≥95%** and you get a free **counter-attack**.
4. Die and the run is over. You keep **Shards**, which unlock more skills and
   pets for future runs.

**Controls:** Levels 1–10 (Ball Hop) are **mouse-movement only — never click**.
A 3D-perspective road runs to the horizon and tiles rush toward you; steer the
ball left and right so it lands on them. Levels 11–20 (Osu Circles) are also
mouse-movement only: follow the numbered circles and their connected motion
line, then be over the target as its approach ring closes. The guide stops at
each phrase boundary, so defense and attack targets never share a connector.
Skills: click a slot
on the right panel or press `1`–`9`/`0`.

---

## Architecture

```
src/
├── core/
│   ├── MusicEngine.js    procedural chiptune (Web Audio), no files
│   ├── Conductor.js      the beat clock — everything syncs to this
│   ├── ChartGen.js       deterministic note charts per level
│   ├── Judge.js          timing windows → judgments
│   ├── CombatResolver.js judgments → damage, both directions
│   ├── RunState.js       hp/mana/stats/skills/pet for the current run
│   ├── SkillEngine.js    fans hooks out to whatever skills you carry
│   └── SaveManager.js    localStorage meta-progression
├── minigames/            MiniGame.js is the contract; BallHop + OsuCircles
├── ui/                   TopHUD, BottomHUD, backdrop — DESIGN.md visual system
├── scenes/               Boot → Calibration → Menu → Upgrade ⇄ Level → GameOver
└── data/                 enemies, 24 skills, 6 pets
```

### Three decisions worth knowing about

**1. The music is generated, not loaded.** `MusicEngine` schedules oscillators
on the same `AudioContext` clock the `Conductor` reads. Beat 32 in the chart is
*exactly* beat 32 in the audio — no encoder lead-in, no BPM drift, no licensing,
no download. Swapping in real audio later means replacing `scheduleBeat()` with a
decoded `AudioBuffer` and leaving everything else alone.

**2. Never derive beat position from frame delta.** `requestAnimationFrame`
jitters and throttles; a delta-based clock drifts a full beat out of sync within
about 30 seconds, and the resulting bug is miserable to diagnose. `Conductor`
reads `AudioContext.currentTime`, which is the same hardware clock feeding the
speakers and therefore cannot drift relative to the music.

**3. Combat never knows which minigame is running.** It only listens for judgment
events. Adding a slap game or rhythm-2048 means writing one file in `minigames/`
and registering it. If you ever need `if (minigame === 'osu')` inside combat
code, the abstraction has leaked — fix it in `MiniGame.js` instead.

---

## Testing

`npm test` is not decoration. It asserts that the JS players actually run
produces the same numbers as `tools/balance_sim.py` — including the exact
enemy-HP curve for all 20 levels. It is very easy for a design spreadsheet and a
game to quietly drift apart, at which point the balance table becomes fiction.

It also guards one specific design property:

> **Offense-per-unit-risk must FALL as difficulty rises.**

If that ever inverts, maxing `Hurry` becomes strictly correct and the skill stops
being a decision. That was a real bug in the first draft of the design doc, and
there is now a test whose only job is to make sure it never comes back.

`npm run test:browser` needs Chrome with its usual shared libraries. If it can't
launch, `npm run test:scene` covers the same UI code paths under jsdom.

---

## Status

Levels 1–20 are playable end to end, with permadeath, stat points, 24 skills,
6 pets, meta-progression, and both minigames. All 24 skills and all 6 enemy
skills are functional and covered by tests.

**Not yet built:** sprite art — every character is drawn from primitives, which
is why the beat-bop matters so much. Sudden Death works but has had light play
testing.

### Bugs found and fixed during verification

Worth knowing about, because the same classes of bug are easy to reintroduce:

| Bug | Why it mattered |
|---|---|
| **Half Time was strictly harmful** | It applied its own 0.7× damage penalty but never actually slowed the notes. You paid 40 mana to get worse. |
| **Overclock, Tempo Thief, Pet Feast did nothing** | Each wrote a flag on `RunState` that no code ever read. They cost mana and had zero effect. |
| **Enemy Jam and Mirror did nothing** | Both were declared, telegraphed on screen with an animation, and unimplemented. |
| **Mirror applied one phrase late** | `maybeEnemySkill()` ran *after* `startPhrase()` had already mapped notes to lanes. |
| **Jam would have been unreadable in Osu** | Movement targets remain timing-driven even when the circles are hidden, so Jam stays a play-by-ear challenge rather than an input deadlock. |
| **Accelerando got erased** | It set the speed tier directly, which the next speed recompute overwrote. |
| **Chill difficulty wasn't easier** | `pow(0.85, max(0, tier-1))` returns 1.0 for both Chill and Normal — identical timing windows. |
| **Calibration measured its own jitter** | The metronome fired from the frame loop, adding up to a frame of error to the very measurement meant to remove latency. Clicks are now pre-scheduled on the audio clock. |
| **Python and JS disagreed on rounding** | `balance_sim.py` used banker's rounding; the game uses `Math.round`. Enemy HP differed by up to 9% at levels 7 and 15. |
| **A test was silently vacuous** | The full-level sim distributed misses with `i % 100 < acc*100`. Phrases have <100 notes, so it produced *zero* misses and every late-game test "passed" at full HP. |
| **Skill offers died after level 1** | Phaser **reuses scene instances** across `scene.start()`. `UpgradeScene.offersResolved` latched `true` on the first visit and was never reset in `init()`, so from level 2 on `takeSkill()` returned immediately — stat points still worked, which is what made it look like a UI problem rather than stale state. |
| **The test harness passed async tests unconditionally** | `test()` called `fn()` inside a `try`, but an `async` body returns a Promise, so a throw inside it never reached the `catch`. It reported PASS and the failure escaped as an unhandled rejection. |
| **Ball Hop judged like a click game** | It opened a ±135ms window and resolved on the first frame inside it, charging that 135ms as timing error. Being in the right lane *early* — good play — scored GOOD at best and MISS if you were 0.1 lanes off centre. The ball hops automatically; position is the only input. |
| **Enemy HP was tuned for a player who doesn't exist** | The HP curve is derived from expected output, but the model assumed a 2.5× combo and a 1.15× pet. No pet exists before level 3 and combo resets on every miss, so real output ran 28–37% under the model and every enemy was inflated to match. |

`npm test` now includes a guard that casts every active skill and asserts it
changed something observable — so a skill can never quietly become decorative
again.
