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
#
# The tab favicons come from the same 'any' artwork: favicon.svg is that source
# copied verbatim (vector, crisp at any zoom), with favicon-32.png and
# favicon-16.png as the raster fallback for engines without SVG favicon
# support. The head declares all three - see dist/index.html.

set -euo pipefail
cd "$(dirname "$0")/.."

UV=${UV:-uv}

$UV run --quiet --with cairosvg python - <<'PY'
import cairosvg
import shutil
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
    # Tab favicons: the sizes a tab strip actually draws. The rounded 'any'
    # artwork is right here - nothing masks a tab icon.
    ('assets/icon.svg',         'favicon-32.png',       32, 'favicon'),
    ('assets/icon.svg',         'favicon-16.png',       16, 'favicon'),
]

for src, name, size, purpose in jobs:
    dst = out / name
    cairosvg.svg2png(url=src, write_to=str(dst),
                     output_width=size, output_height=size)
    data = dst.read_bytes()
    print(f'  {name:<26} {size}x{size}  {len(data):>6} B  ({purpose})')

# The vector favicon is the same 'any' source shipped as-is: no rasterising,
# so it stays crisp on HiDPI tab strips and zoomed browser UIs.
shutil.copyfile(root / 'assets' / 'icon.svg', out / 'favicon.svg')
print(f'  {"favicon.svg":<26} {"vector":>6}  {(out / "favicon.svg").stat().st_size:>6} B  (favicon)')
PY

echo "icons written to dist/icons/"