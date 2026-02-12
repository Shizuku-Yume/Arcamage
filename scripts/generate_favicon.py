#!/usr/bin/env python3
"""
Generate favicon files from SVG logo.
Creates: favicon.ico (16/32/48), favicon-16.png, favicon-32.png, apple-touch-icon.png (180)
"""

import io
from pathlib import Path

import cairosvg
from PIL import Image


def svg_to_png(svg_path: Path, size: int) -> Image.Image:
    """Convert SVG to PNG at specified size."""
    png_data = cairosvg.svg2png(
        url=str(svg_path),
        output_width=size,
        output_height=size,
    )
    img = Image.open(io.BytesIO(png_data))
    # Ensure RGBA mode for ICO compatibility
    return img.convert("RGBA")


def main():
    project_root = Path(__file__).parent.parent
    svg_path = project_root / "frontend" / "public" / "logo.svg"
    output_dir = project_root / "frontend" / "public"

    if not svg_path.exists():
        print(f"Error: SVG not found at {svg_path}")
        return 1

    print(f"Generating favicons from {svg_path}")

    # Generate individual PNGs
    sizes = {
        "favicon-16.png": 16,
        "favicon-32.png": 32,
        "apple-touch-icon.png": 180,
    }

    for filename, size in sizes.items():
        img = svg_to_png(svg_path, size)
        img.save(output_dir / filename, "PNG")
        print(f"  Created {filename} ({size}x{size})")

    # Generate ICO with multiple sizes (16, 32, 48)
    # Pillow ICO: largest first, then append smaller ones
    ico_sizes = [48, 32, 16]
    ico_images = [svg_to_png(svg_path, s) for s in ico_sizes]

    # Save as ICO - Pillow saves all images when using append_images
    ico_path = output_dir / "favicon.ico"
    ico_images[0].save(
        ico_path,
        format="ICO",
        append_images=ico_images[1:],
    )
    print(f"  Created favicon.ico ({'/'.join(str(s) for s in ico_sizes)})")

    print("Done!")
    return 0


if __name__ == "__main__":
    exit(main())
