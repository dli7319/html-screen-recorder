#!/usr/bin/env bash
#
# Regenerate the PNG app icons from the SVG sources in assets/.
#
# Dev-only: the generated PNGs are committed, so neither the build nor CI runs
# this. Run it only when assets/icon*.svg change.
#
# Needs `uv` (https://docs.astral.sh/uv/) plus cairosvg, which is pulled
# on demand rather than added to the project's dependencies - this is the only
# place a rasteriser is needed and it would otherwise drag a graphics stack
# into a Node project.
#
#   ./scripts/build-icons.sh
#
# Why two sources: see the comment at the top of assets/icon.svg. The
# 'maskable' purpose is a different geometry, not a different size.

set -euo pipefail
cd "$(dirname "$0")/.."

UV=${UV:-uv}

$UV run --quiet --with cairosvg python - <<'PY'
import cairosvg
from pathlib import Path

root = Path('.')
out = root / 'dist' / 'icons'
out.mkdir(parents=True, exist_ok=True)

# (source svg, output png, size, purpose)
jobs = [
    ('assets/icon.svg',         'icon-192.png',         192, 'any'),
    ('assets/icon.svg',         'icon-512.png',         512, 'any'),
    ('assets/icon-maskable.svg', 'icon-512-maskable.png', 512, 'maskable'),
    # iOS masks the corners itself and wants a fully opaque square, so it gets
    # the full-bleed artwork rather than the rounded 'any' variant.
    ('assets/icon-maskable.svg', 'apple-touch-icon.png', 180, 'apple-touch'),
]

for src, name, size, purpose in jobs:
    dst = out / name
    cairosvg.svg2png(url=src, write_to=str(dst),
                     output_width=size, output_height=size)
    data = dst.read_bytes()
    print(f'  {name:<26} {size}x{size}  {len(data):>6} B  ({purpose})')
PY

echo "icons written to dist/icons/"