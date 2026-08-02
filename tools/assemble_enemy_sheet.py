"""Assemble one enemy's retained 256px source frames into its runtime sheet."""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

STATES = (
    "idle", "windup", "attack", "hurt", "defense",
    "cast", "stun", "victory", "death", "phase_change",
)
FRAME_SIZE = (256, 256)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--enemy", type=int, required=True, choices=range(1, 21))
    parser.add_argument("--frames-root", type=Path, default=Path("public/assets/enemies/frames"))
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()

    enemy_dir = args.frames_root / f"e{args.enemy:02d}"
    output = args.out or Path("public/assets/enemies") / f"enemy_anim_{args.enemy:02d}.png"
    missing = []
    frames: list[Image.Image] = []
    for state in STATES:
        for index in range(1, 9):
            source = enemy_dir / state / f"{index:02d}.png"
            if not source.exists():
                missing.append(str(source))
                continue
            image = Image.open(source).convert("RGBA")
            if image.size != FRAME_SIZE:
                raise SystemExit(f"{source}: expected 256x256, got {image.size[0]}x{image.size[1]}")
            if image.getpixel((0, 0))[3] != 0:
                raise SystemExit(f"{source}: top-left pixel is not transparent")
            frames.append(image)

    if missing:
        raise SystemExit("Missing source frames:\n" + "\n".join(missing))

    sheet = Image.new("RGBA", (FRAME_SIZE[0] * 8, FRAME_SIZE[1] * len(STATES)), (0, 0, 0, 0))
    frame_index = 0
    for row in range(len(STATES)):
        for col in range(8):
            sheet.alpha_composite(frames[frame_index], (col * FRAME_SIZE[0], row * FRAME_SIZE[1]))
            frame_index += 1
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output, format="PNG", optimize=True)
    print(f"Wrote {output} ({sheet.width}x{sheet.height})")


if __name__ == "__main__":
    main()
