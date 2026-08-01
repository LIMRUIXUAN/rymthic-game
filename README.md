# RYTHMIC

A rhythm roguelike built with Phaser. The enemy sets the tempo, and you answer with your mouse.

[Play RYTHMIC online](https://rythmic-game.ruixuan0805.chatgpt.site)

## What is it?

Build a run through 20 levels, choosing stats, skills, and pets as the pressure rises. Each phrase asks you to defend against incoming notes or turn accurate hits into damage. After stage 8, both sides receive escalating damage and the player gets one transition grace hit, while Shards unlock more options for future attempts.

The game includes:

- Two movement-focused rhythm modes: Ball Hop for levels 1 to 10, then Osu Circles for levels 11 to 20.
- 24 player skills, six pets, and enemy abilities that change how a phrase plays.
- Procedural combat music, menu tracks, and persistent local progression.

## How to play

1. Calibrate your timing with the opening beat check.
2. Spend stat points and choose a skill, or skip a skill for an extra point.
3. During each phrase:
   - **Defend**: hit red notes to block incoming damage.
   - **Attack**: hit green notes accurately to deal more damage.
   - Clear a phrase at 95% accuracy or higher to earn a counterattack.
4. Keep moving through the run. If you die, you keep Shards for later unlocks.

Levels 1 to 10 use Ball Hop. Move the mouse left and right to guide the ball onto incoming tiles. Levels 11 to 20 use Osu Circles. Follow the numbered targets and be over each circle as its approach ring closes. Neither mode requires clicking.

Skills can be activated from the right-side panel or with `1` through `9` and `0`.

## Run locally

```bash
npm install
npm run dev
```

Open the address printed by Vite, usually `http://localhost:5173`.

All game art, music, and fonts are included in the repository. No separate asset download is needed.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Starts the development server with hot reload. |
| `npm run build` | Creates a production build in `dist/`. |
| `npm test` | Runs combat, progression, balance, chart, and skill tests. |
| `npm run test:scene` | Runs scene and minigame checks with jsdom. |
| `npm run test:browser` | Runs a headless-browser smoke test when Puppeteer is installed. |
| `npm run balance` | Regenerates the balance table. |

## Project structure

```text
src/
├── core/        Timing, combat, music, saves, skills, and run state
├── data/        Enemies, skills, and pets
├── minigames/   Ball Hop, Osu Circles, and the shared game contract
├── scenes/      Boot, menu, upgrades, levels, and game over
└── ui/          HUDs, effects, widgets, and backdrop rendering
```

The design and balancing references live in [GAME_DESIGN.md](GAME_DESIGN.md), [DESIGN.md](DESIGN.md), and [GAME_PLAN.md](GAME_PLAN.md).

## Technical notes

- `Conductor` uses the Web Audio clock, so note timing stays aligned with the music instead of drifting with frame rate.
- Combat only consumes judgment events, so minigames remain independent from damage and progression systems.
- The test suite checks game balance as well as behavior, including enemy health curves, timing windows, skill effects, and full-run simulations.

## Status

RYTHMIC is playable from start to finish with 20 levels, progression, skills, pets, and both rhythm modes. Feedback and bug reports are welcome through the repository issues.
