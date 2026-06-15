#!/usr/bin/env python3
"""Regenerate Android launcher icons with larger foreground margins."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / "src-tauri"
ICON_SRC = ROOT / "icons" / "icon.png"
ANDROID_DIR = ROOT / "icons" / "android"
BG_COLOR = (51, 107, 175, 255)
FG_SCALE = 0.42
CORNER_RADIUS_RATIO = 0.22

DENSITIES = {
    "mipmap-mdpi": (48, 108),
    "mipmap-hdpi": (72, 162),
    "mipmap-xhdpi": (96, 216),
    "mipmap-xxhdpi": (144, 324),
    "mipmap-xxxhdpi": (192, 432),
}


def extract_foreground(source: Image.Image) -> Image.Image:
    rgba = source.convert("RGBA")
    width, height = rgba.size
    foreground = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    src_pixels = rgba.load()
    fg_pixels = foreground.load()
    for y in range(height):
        for x in range(width):
            red, green, blue, alpha = src_pixels[x, y]
            if alpha > 16 and red > 210 and green > 210 and blue > 210:
                fg_pixels[x, y] = (255, 255, 255, alpha)
    return foreground


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def scale_foreground(cropped: Image.Image, canvas_size: int) -> Image.Image:
    max_content = max(1, int(canvas_size * FG_SCALE))
    scale = max_content / max(cropped.size)
    scaled_size = (
        max(1, int(cropped.width * scale)),
        max(1, int(cropped.height * scale)),
    )
    return cropped.resize(scaled_size, Image.Resampling.LANCZOS)


def compose_launcher(source_fg: Image.Image, launcher_size: int) -> Image.Image:
    bbox = source_fg.getbbox()
    if not bbox:
        raise RuntimeError("Could not find foreground content in icon.png")

    cropped = source_fg.crop(bbox)
    scaled = scale_foreground(cropped, launcher_size)
    scaled_size = scaled.size

    radius = int(launcher_size * CORNER_RADIUS_RATIO)
    mask = rounded_mask(launcher_size, radius)
    background = Image.new("RGBA", (launcher_size, launcher_size), BG_COLOR)
    background.putalpha(mask)

    canvas = Image.new("RGBA", (launcher_size, launcher_size), (0, 0, 0, 0))
    canvas.paste(scaled, ((launcher_size - scaled_size[0]) // 2, (launcher_size - scaled_size[1]) // 2), scaled)
    return Image.alpha_composite(background, canvas)


def compose_adaptive_foreground(source_fg: Image.Image, foreground_size: int) -> Image.Image:
    bbox = source_fg.getbbox()
    if not bbox:
        raise RuntimeError("Could not find foreground content in icon.png")

    cropped = source_fg.crop(bbox)
    scaled = scale_foreground(cropped, foreground_size)
    scaled_size = scaled.size

    canvas = Image.new("RGBA", (foreground_size, foreground_size), (0, 0, 0, 0))
    canvas.paste(
        scaled,
        ((foreground_size - scaled_size[0]) // 2, (foreground_size - scaled_size[1]) // 2),
        scaled,
    )
    return canvas


def main() -> None:
    source = Image.open(ICON_SRC)
    foreground = extract_foreground(source)

    for folder, (launcher_size, adaptive_size) in DENSITIES.items():
        out_dir = ANDROID_DIR / folder
        out_dir.mkdir(parents=True, exist_ok=True)

        launcher = compose_launcher(foreground, launcher_size)
        adaptive = compose_adaptive_foreground(foreground, adaptive_size)

        launcher.save(out_dir / "ic_launcher.png")
        launcher.save(out_dir / "ic_launcher_round.png")
        adaptive.save(out_dir / "ic_launcher_foreground.png")

    print(f"Generated Android icons with foreground scale {FG_SCALE:.0%}")


if __name__ == "__main__":
    main()
