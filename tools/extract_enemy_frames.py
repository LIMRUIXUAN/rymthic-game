"""Extract a generated 8×10 sheet into retained 256px state frames."""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

STATES = (
    "idle", "windup", "attack", "hurt", "defense",
    "cast", "stun", "victory", "death", "phase_change",
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--enemy", type=int, required=True, choices=range(1, 21))
    parser.add_argument("--out-root", type=Path, default=Path("public/assets/enemies/frames"))
    parser.add_argument("--inset", type=int, default=0, help="trim this many source pixels inside every cell boundary")
    args = parser.parse_args()

    source = Image.open(args.input).convert("RGBA")
    cols, rows = 8, 10
    out_enemy = args.out_root / f"e{args.enemy:02d}"
    for row, state in enumerate(STATES):
        for col in range(cols):
            left = round(col * source.width / cols) + args.inset
            top = round(row * source.height / rows) + args.inset
            right = round((col + 1) * source.width / cols) - args.inset
            bottom = round((row + 1) * source.height / rows) - args.inset
            if right <= left or bottom <= top:
                raise SystemExit(f"--inset {args.inset} is too large for the source cell")
            frame = source.crop((left, top, right, bottom)).resize((256, 256), Image.Resampling.LANCZOS)
            alpha = frame.getchannel("A").point(lambda value: 0 if value <= 8 else value)
            frame.putalpha(alpha)
            target = out_enemy / state / f"{col + 1:02d}.png"
            target.parent.mkdir(parents=True, exist_ok=True)
            frame.save(target, format="PNG", optimize=True)
    print(f"Extracted {len(STATES) * cols} frames under {out_enemy}")


if __name__ == "__main__":
    main()
