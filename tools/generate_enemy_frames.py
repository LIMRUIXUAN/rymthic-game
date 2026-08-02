"""Generate a consistent 8-frame set for each enemy state from one clean cutout."""
from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

STATES = (
    "idle", "windup", "attack", "hurt", "defense",
    "cast", "stun", "victory", "death", "phase_change",
)
SIZE = 256


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def add_glow(canvas: Image.Image, color: tuple[int, int, int], radius: int, alpha: int) -> None:
    mask = canvas.getchannel("A").filter(ImageFilter.GaussianBlur(radius))
    glow = Image.new("RGBA", canvas.size, (*color, 0))
    glow.putalpha(mask.point(lambda value: value * alpha // 255))
    canvas.alpha_composite(glow)


def add_ring(canvas: Image.Image, color: tuple[int, int, int], scale: float, alpha: int) -> None:
    draw = ImageDraw.Draw(canvas, "RGBA")
    box = (SIZE * (0.17 - scale * 0.02), SIZE * (0.17 - scale * 0.02),
           SIZE * (0.83 + scale * 0.02), SIZE * (0.83 + scale * 0.02))
    draw.ellipse(box, outline=(*color, alpha), width=3)


def make_base(source: Image.Image) -> Image.Image:
    source = source.convert("RGBA")
    bbox = source.getchannel("A").getbbox()
    if not bbox:
        raise SystemExit("input cutout has no opaque pixels")
    source = source.crop(bbox)
    scale = min(218 / source.width, 218 / source.height)
    source = source.resize((round(source.width * scale), round(source.height * scale)), Image.Resampling.LANCZOS)
    base = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    base.alpha_composite(source, ((SIZE - source.width) // 2, (SIZE - source.height) // 2))
    return base


def make_frame(base: Image.Image, state: str, index: int) -> Image.Image:
    t = index / 7
    phase = math.sin(t * math.tau)
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))

    scale = 1.0
    angle = 0.0
    dx = 0
    dy = 0
    alpha = 255
    if state == "idle":
        scale = 1.0 + 0.035 * phase
        dy = round(-2 * phase)
    elif state == "windup":
        scale = lerp(1.0, 0.94, t) if t < 0.5 else lerp(0.94, 1.0, (t - 0.5) * 2)
        angle = lerp(0, -5, min(t * 2, 1)) if t < 0.5 else lerp(-5, 0, (t - 0.5) * 2)
        dx = round(-3 * min(t * 2, 1))
    elif state == "attack":
        scale = 1.0 + 0.08 * math.sin(t * math.pi)
        angle = lerp(0, -9, min(t * 1.5, 1)) if t < 0.67 else lerp(-9, 0, (t - 0.67) / 0.33)
        dx = round(lerp(0, 13, min(t * 1.5, 1)))
    elif state == "hurt":
        scale = 1.0 + 0.05 * math.sin(t * math.pi)
        angle = 8 * math.sin(t * math.pi * 2)
        dx = round(7 * math.sin(t * math.pi * 2))
        if index in (0, 1):
            flash = ImageEnhance.Brightness(base).enhance(2.2)
            flash.putalpha(base.getchannel("A").point(lambda value: value * (1 - index * 0.35)))
            base_to_draw = flash
        else:
            base_to_draw = base
    elif state == "defense":
        scale = 1.03 + 0.025 * phase
        dy = round(-2 * phase)
        add_ring(canvas, (94, 242, 255), 1, 110)
        base_to_draw = base
    elif state == "cast":
        scale = 1.02 + 0.04 * math.sin(t * math.pi)
        dy = round(-3 * math.sin(t * math.pi))
        add_ring(canvas, (167, 139, 250), 1 + t, 130)
        base_to_draw = base
    elif state == "stun":
        scale = 1.0 + 0.04 * math.sin(t * math.pi)
        angle = 9 * math.sin(t * math.tau * 1.5)
        dx = round(4 * math.sin(t * math.tau * 1.5))
        draw = ImageDraw.Draw(canvas, "RGBA")
        for x, y in ((42, 52), (214, 62), (48, 188), (210, 182)):
            draw.regular_polygon((x, y, 7), n_sides=4, rotation=45, fill=(255, 228, 94, 210))
        base_to_draw = base
    elif state == "victory":
        scale = 1.0 + 0.07 * math.sin(t * math.pi)
        dy = round(-7 * math.sin(t * math.pi))
        angle = -3 * math.sin(t * math.pi)
        add_ring(canvas, (255, 209, 102), 1, 90)
        base_to_draw = base
    elif state == "death":
        scale = lerp(1.0, 0.72, t)
        angle = lerp(0, 18, t)
        dy = round(lerp(0, 30, t))
        alpha = round(255 * (1 - max(0, t - 0.55) / 0.45))
        base_to_draw = base
    elif state == "phase_change":
        scale = 1.0 + 0.12 * math.sin(t * math.pi)
        angle = 3 * math.sin(t * math.pi * 2)
        add_ring(canvas, (0, 212, 255), 1 + t, 170)
        add_glow(canvas, (0, 212, 255), 8, 90)
        base_to_draw = base
    else:
        base_to_draw = base

    if state == "hurt" and index in (0, 1):
        pass
    elif state != "hurt":
        base_to_draw = base

    rendered = base_to_draw.resize((round(SIZE * scale), round(SIZE * scale)), Image.Resampling.BICUBIC)
    rendered = rendered.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)
    rendered.putalpha(rendered.getchannel("A").point(lambda value: value * alpha // 255))
    canvas.alpha_composite(rendered, ((SIZE - rendered.width) // 2 + dx, (SIZE - rendered.height) // 2 + dy))
    return canvas


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--enemy", type=int, required=True, choices=range(1, 21))
    parser.add_argument("--out-root", type=Path, default=Path("public/assets/enemies/frames"))
    args = parser.parse_args()

    base = make_base(Image.open(args.input))
    enemy_root = args.out_root / f"e{args.enemy:02d}"
    for state in STATES:
        for index in range(8):
            target = enemy_root / state / f"{index + 1:02d}.png"
            target.parent.mkdir(parents=True, exist_ok=True)
            make_frame(base, state, index).save(target, format="PNG", optimize=True)
    print(f"Generated {len(STATES) * 8} frames under {enemy_root}")


if __name__ == "__main__":
    main()
