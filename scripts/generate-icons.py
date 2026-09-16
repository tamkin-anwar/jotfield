"""Render every Jotfield icon from the same canonical SVG mark."""
from io import BytesIO
from pathlib import Path
import cairosvg
from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / 'public'
MASTER = 4096
svg = (ROOT / 'jotfield-icon.svg').read_bytes()
regular = Image.open(BytesIO(cairosvg.svg2png(bytestring=svg, output_width=MASTER, output_height=MASTER))).convert('RGBA')
regular.save(ROOT / 'jotfield-icon-4096.png', optimize=True)
for size in (1024, 512, 384, 192):
    regular.resize((size, size), Image.Resampling.LANCZOS).save(ROOT / f'jotfield-icon-{size}.png', optimize=True)

# Platforms that mask icons need padding and an opaque canvas, using the identical mark.
safe = Image.new('RGBA', (MASTER, MASTER), '#f5efe4')
mark = regular.resize((int(MASTER * .78), int(MASTER * .78)), Image.Resampling.LANCZOS)
offset = (MASTER - mark.width) // 2
safe.alpha_composite(mark, (offset, offset))
safe.resize((180, 180), Image.Resampling.LANCZOS).save(ROOT / 'apple-touch-icon.png', optimize=True)
for size in (1024, 512):
    safe.resize((size, size), Image.Resampling.LANCZOS).save(ROOT / f'jotfield-icon-maskable-{size}.png', optimize=True)
favicon_svg = (ROOT / 'jotfield-favicon.svg').read_bytes()
favicon = Image.open(BytesIO(cairosvg.svg2png(bytestring=favicon_svg, output_width=256, output_height=256))).convert('RGBA')
favicon.save(ROOT / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print('Rendered all Jotfield icons from public/jotfield-icon.svg')
