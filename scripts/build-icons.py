"""Export the selected logo to square extension assets; requires Pillow."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
source = Image.open(ROOT / 'docs/logo-source.png').convert('RGBA')
# Ignore nearly invisible generated pixels when locating the artwork, while
# preserving the original RGBA pixels inside the crop and the untouched source.
bounds = source.getchannel('A').point(lambda value: 255 if value >= 10 else 0).getbbox()
if not bounds:
    raise ValueError('Logo source has no visible artwork')
left, top, right, bottom = bounds
art = source.crop((max(0, left - 2), max(0, top - 2), min(source.width, right + 2), min(source.height, bottom + 2)))
art.thumbnail((960, 960), Image.Resampling.LANCZOS)
logo = Image.new('RGBA', (1024, 1024))
logo.alpha_composite(art, ((1024 - art.width) // 2, (1024 - art.height) // 2))
logo.save(ROOT / 'extension/assets/imagetaken-logo.png')
for size in (16, 32, 48, 128):
    logo.resize((size, size), Image.Resampling.LANCZOS).save(ROOT / f'extension/icons/{size}.png')

preview = Image.new('RGB', (800, 440))
draw = ImageDraw.Draw(preview)
for offset, background, foreground in ((0, '#ffffff', '#252a30'), (400, '#191c21', '#ffffff')):
    draw.rectangle((offset, 0, offset + 399, 439), fill=background)
    preview.paste(logo.resize((240, 240), Image.Resampling.LANCZOS), (offset + 80, 12), mask=logo.resize((240, 240), Image.Resampling.LANCZOS))
    for position, size in ((40, 16), (100, 32), (176, 48), (256, 128)):
        x = offset + position
        icon = Image.open(ROOT / f'extension/icons/{size}.png')
        preview.paste(icon, (x, 272), mask=icon)
        draw.text((x, 413), f'{size}px', fill=foreground)
preview.save(ROOT / 'docs/logo-preview.png')
