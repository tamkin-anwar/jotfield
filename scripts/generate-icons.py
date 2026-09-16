from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1] / 'public'
MASTER = 4096
COLORS = ('#356df3', '#ff7043', '#c7e868')


def background(size):
    image = Image.new('RGB', (size, size), '#f7f1e7')
    pixels = image.load()
    for y in range(size):
        for x in range(size):
            dx, dy = (x - size * .48) / size, (y - size * .42) / size
            radius = min(1, (dx * dx + dy * dy) ** .5 / .7)
            glow = int(14 * (1 - radius))
            pixels[x, y] = (min(255, 241 + glow), min(255, 232 + glow), min(255, 218 + glow // 2))
    return image.convert('RGBA')


def capsule(color, length, thick, angle):
    pad = thick
    layer = Image.new('RGBA', (length + pad * 2, thick + pad * 2))
    shadow = Image.new('RGBA', layer.size)
    ImageDraw.Draw(shadow).rounded_rectangle((pad, pad, pad + length, pad + thick), radius=thick // 2, fill=(60, 35, 20, 70))
    shadow = shadow.filter(ImageFilter.GaussianBlur(thick // 7))
    shape = Image.new('RGBA', layer.size)
    ImageDraw.Draw(shape).rounded_rectangle((pad, pad, pad + length, pad + thick), radius=thick // 2, fill=color)
    layer.alpha_composite(shadow, (0, thick // 12))
    layer.alpha_composite(shape)
    return layer.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)


def compose(scale=1.0, canvas=None):
    image = canvas.copy() if canvas else Image.new('RGBA', (MASTER, MASTER), (0, 0, 0, 0))
    length, thick = int(1480 * scale), int(610 * scale)
    centers = [(1470, 1710), (2050, 2050), (2630, 2390)]
    origin = (2050, 2050)
    for color, (center_x, center_y) in zip(COLORS, centers):
        center_x = int(origin[0] + (center_x - origin[0]) * scale)
        center_y = int(origin[1] + (center_y - origin[1]) * scale)
        item = capsule(color, length, thick, -38)
        image.alpha_composite(item, (center_x - item.width // 2, center_y - item.height // 2))
    return image


regular = compose(1.18)
maskable = compose(.78, background(MASTER))
apple = compose(.78, background(MASTER))

regular.save(ROOT / 'jotfield-icon-4096.png', optimize=True)
for size in (1024, 512, 384, 192):
    regular.resize((size, size), Image.Resampling.LANCZOS).save(ROOT / f'jotfield-icon-{size}.png', optimize=True)
apple.resize((180, 180), Image.Resampling.LANCZOS).save(ROOT / 'apple-touch-icon.png', optimize=True)
for size in (1024, 512):
    maskable.resize((size, size), Image.Resampling.LANCZOS).save(ROOT / f'jotfield-icon-maskable-{size}.png', optimize=True)
regular.resize((256, 256), Image.Resampling.LANCZOS).save(ROOT / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print('Generated transparent browser icons and safe home-screen icons from a 4096 px master')
