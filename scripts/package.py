"""Build a loadable ZIP, with manifest.json at its root and no test/dev files."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
import subprocess

root = Path(__file__).resolve().parents[1]
subprocess.run(['npm', 'run', 'check'], cwd=root, check=True)
version = json.loads((root / 'extension/manifest.json').read_text())['version']
target = root / 'dist' / f'imagetaken-{version}.zip'
target.parent.mkdir(exist_ok=True)
temporary = target.with_suffix('.zip.tmp')
with ZipFile(temporary, 'w', ZIP_DEFLATED) as archive:
    for file in sorted((root / 'extension').rglob('*')):
        if file.is_file() and not file.name.startswith('.') and file.suffix not in {'.ts', '.map'}:
            archive.write(file, file.relative_to(root / 'extension'))
temporary.replace(target)
print(target)
