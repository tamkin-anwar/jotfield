from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1] / 'public'
MASTER = 4096
COLORS = ('#356df3', '#ff7043', '#c7e868')

def background(size):
    im = Image.new('RGB', (size, size), '#f7f1e7')
    px = im.load()
    for y in range(size):
        for x in range(size):
            dx, dy = (x-size*.48)/size, (y-size*.42)/size
            r = min(1, (dx*dx+dy*dy)**.5/.7)
            glow = int(14*(1-r))
            px[x,y] = (min(255, 241+glow), min(255, 232+glow), min(255, 218+glow//2))
    return im

def capsule(color, length, thick, angle):
    pad = thick
    layer = Image.new('RGBA', (length+pad*2, thick+pad*2))
    shadow = Image.new('RGBA', layer.size)
    ImageDraw.Draw(shadow).rounded_rectangle((pad, pad, pad+length, pad+thick), radius=thick//2, fill=(60,35,20,85))
    shadow = shadow.filter(ImageFilter.GaussianBlur(thick//7))
    shape = Image.new('RGBA', layer.size)
    d = ImageDraw.Draw(shape)
    d.rounded_rectangle((pad, pad, pad+length, pad+thick), radius=thick//2, fill=color)
    layer.alpha_composite(shadow, (0, thick//12))
    layer.alpha_composite(shape)
    return layer.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)

def compose(scale=1.0):
    im = background(MASTER).convert('RGBA')
    length, thick = int(1480*scale), int(610*scale)
    centers = [(1470,1710),(2050,2050),(2630,2390)]
    center0=(2050,2050)
    for color, (cx,cy) in zip(COLORS, centers):
        cx = int(center0[0] + (cx-center0[0])*scale)
        cy = int(center0[1] + (cy-center0[1])*scale)
        item = capsule(color, length, thick, -38)
        im.alpha_composite(item, (cx-item.width//2, cy-item.height//2))
    return im.convert('RGB')

regular = compose(1.0)
maskable = compose(.78)
regular.save(ROOT/'jotfield-icon-4096.png', optimize=True)
for size in (1024,512,384,192,180):
    out = regular.resize((size,size), Image.Resampling.LANCZOS)
    name = 'apple-touch-icon.png' if size == 180 else f'jotfield-icon-{size}.png'
    out.save(ROOT/name, optimize=True)
for size in (1024,512):
    maskable.resize((size,size), Image.Resampling.LANCZOS).save(ROOT/f'jotfield-icon-maskable-{size}.png', optimize=True)
print('Generated Jotfield icon family from a 4096 px master')
