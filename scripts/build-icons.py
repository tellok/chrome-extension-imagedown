"""Export the selected logo to square extension assets; requires Pillow and resvg-py."""
from pathlib import Path
import resvg_py
from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parents[1]
source = Image.open(ROOT / 'docs/logo-source.png').convert('RGBA')
# Ignore nearly invisible generated pixels when locating the artwork, while
# preserving the original RGBA pixels inside the crop and the untouched source.
bounds = source.getchannel('A').point(lambda value: 255 if value >= 10 else 0).getbbox()
if not bounds:
    raise ValueError('Logo source has no visible artwork')
art = source.crop(bounds)


def icon_at(size):
    # Chrome supplies the toolbar spacing. Fill the available image bounds,
    # allowing upscaling rather than adding another layer of transparent padding.
    scaled = ImageOps.contain(art, (size, size), Image.Resampling.LANCZOS)
    icon = Image.new('RGBA', (size, size))
    icon.alpha_composite(scaled, ((size - scaled.width) // 2, (size - scaled.height) // 2))
    return icon


logo = icon_at(1024)
logo.save(ROOT / 'extension/assets/imagetaken-logo.png')
for size in (16, 32, 48, 128):
    icon_at(size).save(ROOT / f'extension/icons/{size}.png')

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

# Chrome toolbar assets use a thinner frame so the visible blue body fills the
# same optical area as neighboring icons. Keep the selected original elsewhere.
for size in (16, 24, 32, 48, 128):
    (ROOT / f'extension/icons/toolbar-{size}.png').write_bytes(resvg_py.svg_to_bytes(
        svg_path=str(ROOT / 'extension/assets/toolbar-logo.svg'), width=size, height=size))

toolbar_preview = Image.new('RGB', (800, 180))
draw = ImageDraw.Draw(toolbar_preview)
for offset, background, foreground in ((0, '#ffffff', '#252a30'), (400, '#303030', '#ffffff')):
    draw.rectangle((offset, 0, offset + 399, 179), fill=background)
    for position, size in ((16, 16), (64, 24), (112, 32), (168, 48), (248, 128)):
        icon = Image.open(ROOT / f'extension/icons/toolbar-{size}.png').convert('RGBA')
        toolbar_preview.paste(icon, (offset + position, 12), mask=icon)
        draw.text((offset + position, 155), f'{size}px', fill=foreground)
toolbar_preview.save(ROOT / 'docs/toolbar-logo-preview.png')
