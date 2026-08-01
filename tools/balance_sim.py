#!/usr/bin/env python3
"""
RYTHMIC balance simulator.

Regenerates the level table in GAME_DESIGN.md section 11.
Re-run this any time you change a combat coefficient.

    python3 tools/balance_sim.py

Design targets (verified by `npm test`, which asserts the enemy HP table):
  - normal enemy, 90% accuracy  -> kill at ~139% (song to spare)
  - boss,         90% accuracy  -> kill at ~114% (tight, must not choke)
  - 80% accuracy                -> run ends at the final boss (level 20)
  - 85% accuracy                -> clears level 20 on a knife's edge (~6%)
  - 90% accuracy                -> clears level 20 with ~47% HP
  - 95% accuracy                -> clears comfortably (~88% HP)

GAME_PLAN C9 soft-punishment buffer is modelled in `taken()`: the first miss
of every phrase is absorbed (misses are assumed to spread evenly across
phrases, so each phrase shields min(1, per-phrase misses) of them). This
shifted the whole curve right by roughly one accuracy tier.
"""

import math

BOSS = {5, 10, 15, 20}


def jsround(x):
    """Match JavaScript's Math.round (half UP), not Python's round (half to EVEN).

    This is not a nitpick. Python's round(4.5) == 4 while JS Math.round(4.5) == 5,
    and the stat allocation lands exactly on .5 at levels 3, 7, 11, 15 and 19.
    Using Python's default made this simulator disagree with the shipped game by
    up to 9% enemy HP on those levels. The game is what players actually run, so
    the simulator matches the game.
    """
    return math.floor(x + 0.5) if x >= 0 else math.ceil(x - 0.5)

NAMES = {
    1: "Tin Drummer",      2: "Snare Sprite",       3: "Hi-Hat Harpy",
    4: "Kick Golem",       5: "THE CONDUCTOR",      6: "Bassline Wraith",
    7: "Loop Fiend",       8: "Reverb Ghoul",       9: "Clipping Beast",
    10: "THE MIXER",       11: "Sine Serpent",      12: "Glitch Imp",
    13: "Sidechain Stalker", 14: "Distortion Djinn", 15: "THE PRODUCER",
    16: "Null Chorus",     17: "Phase Reaper",      18: "Silence Warden",
    19: "Feedback Titan",  20: "THE ENCORE",
}

# ---- tunable coefficients -------------------------------------------------
K_OUT = 0.25          # per-note attack coefficient
K_IN = 0.10           # per-missed-note damage coefficient
POINTS_PER_LEVEL = 3
BASE = {"hp": 100, "mana": 30, "def": 0, "atk": 20}
GAIN = {"hp": 12, "mana": 5, "def": 4, "atk": 3}

DIFF_ATK = {"Chill": 1.0, "Normal": 1.30, "Hurry": 1.60, "Frenzy": 2.00}
DIFF_RISK = {"Chill": 1.0, "Normal": 1.45, "Hurry": 2.00, "Frenzy": 2.80}

NORMAL_HP_FACTOR = 0.72   # enemy HP as fraction of expected player output
BOSS_HP_FACTOR = 0.88

# Assumptions behind "expected output". These must stay CONSERVATIVE: a
# competent player with no pet and an interrupted combo. The first version
# assumed combo 2.5 and pet 1.15 -- a flawless run with a companion -- which
# inflated every enemy by 28-37% and made fights drag.
ASSUMED_COMBO = 1.8
ASSUMED_PET = 1.0
BOSS_ATK_MULT = 1.4
BOSS_DEF_BONUS = 20
# ---------------------------------------------------------------------------


# Notes per phrase, capped by the chart generator's 0.5-beat minimum gap:
# 16 beats / 0.5 = 32 is the hard ceiling, so 28 leaves headroom. The old
# 24 -> 40 range demanded up to 2.5 notes per beat, which forced the generator
# to stack tiles on top of each other.
def notes(n):    return jsround(16 + (n - 1) * (12 / 19))      # 16 -> 28
def pairs(n):    return 3 if n <= 5 else (4 if n <= 15 else 5)
def bpm(n):      return jsround(96 + (n - 1) * (84 / 19))    # 96 -> 180
def enemy_def(n): return 3 * (n - 1) + (BOSS_DEF_BONUS if n in BOSS else 0)
def enemy_atk(n): return 14 * (1.12 ** (n - 1)) * (BOSS_ATK_MULT if n in BOSS else 1.0)
def reduction(d): return d / (d + 100)


def hero(n, split=(0.25, 0.25, 0.25, 0.25)):
    """Stats at level n for a given point allocation (hp, mana, def, atk)."""
    pts = (n - 1) * POINTS_PER_LEVEL
    h, m, d, a = (jsround(pts * s) for s in split)
    return (BASE["hp"] + h * GAIN["hp"], BASE["mana"] + m * GAIN["mana"],
            BASE["def"] + d * GAIN["def"], BASE["atk"] + a * GAIN["atk"])


def output(n, acc, diff="Normal", pet=ASSUMED_PET, combo=ASSUMED_COMBO, split=(.25,) * 4):
    atk = hero(n, split)[3]
    return (notes(n) * atk * K_OUT * acc * combo * pet
            * DIFF_ATK[diff] * (1 - reduction(enemy_def(n))) * pairs(n))


def enemy_hp(n):
    base = output(n, 0.90)
    factor = BOSS_HP_FACTOR if n in BOSS else NORMAL_HP_FACTOR
    return jsround(base * factor / 10) * 10


def taken(n, acc, diff="Normal", split=(.25,) * 4):
    dfn = hero(n, split)[2]
    per_phrase = notes(n) * (1 - acc)
    # GAME_PLAN C9 soft-punishment buffer: the first miss of every phrase is
    # absorbed. Conservative approximation: misses spread evenly across
    # phrases, so each phrase shields min(1, per-phrase misses) of them.
    misses = max(0.0, per_phrase - min(1, per_phrase)) * pairs(n)
    return (enemy_atk(n) * K_IN * misses * DIFF_RISK[diff]
            * (1 - reduction(dfn)))


def mana_income(n, acc):
    return (4 + 10 * acc * acc) * pairs(n) * 2


def check_difficulty_is_a_tradeoff():
    """Offense-per-unit-risk must FALL as difficulty rises, or Frenzy is free."""
    ratios = []
    for tier in DIFF_ATK:
        off, inc = 0.90 * DIFF_ATK[tier], 0.10 * DIFF_RISK[tier]
        ratios.append((tier, off / inc))
    ok = all(ratios[i][1] > ratios[i + 1][1] for i in range(len(ratios) - 1))
    print("\nDifficulty trade-off check (offense per unit of risk @90% acc):")
    for tier, r in ratios:
        print(f"  {tier:>7}  {r:>5.2f}")
    print(f"  => {'PASS' if ok else 'FAIL'}: higher difficulty must give less offense per risk.")
    return ok


def main():
    print("| Lv | Enemy | Game | BPM | Notes/ph | Pairs | Enemy HP | ATK | DEF "
          "| Kill @90% | HP left @80% | @90% | @95% |")
    print("|----|-------|------|-----|----|----|------|-----|-----|------|------|------|------|")
    for n in range(1, 21):
        hp = hero(n)[0]
        ehp = enemy_hp(n)
        game = "Ball Hop" if n <= 10 else "Osu"
        name = f"**{NAMES[n]}**" if n in BOSS else NAMES[n]
        lv = f"**{n}**" if n in BOSS else str(n)
        left = [round((hp - taken(n, a)) / hp * 100) for a in (0.80, 0.90, 0.95)]
        print(f"| {lv} | {name} | {game} | {bpm(n)} | {notes(n)} | {pairs(n)} | {ehp} | "
              f"{enemy_atk(n):.0f} | {enemy_def(n)} | {output(n, 0.90) / ehp * 100:.0f}% | "
              f"{left[0]}% | {left[1]}% | {left[2]}% |")

    print("\nMana income vs pool:")
    for n in (1, 10, 20):
        print(f"  lv{n:>2}: income @90% acc = {mana_income(n, 0.90):>5.0f}   "
              f"max pool = {hero(n)[1]:>3}")

    check_difficulty_is_a_tradeoff()


if __name__ == "__main__":
    main()
