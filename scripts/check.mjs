import { readdir, readFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
for (const file of ['panel.html', 'panel.css', manifest.options_ui.page, 'settings.css', manifest.background.service_worker, ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon), ...(manifest.content_scripts || []).flatMap(script => script.js || [])]) {
  await access(`extension/${file}`);
}
for (const file of await readdir('extension')) {
  if (file.endsWith('.js')) execFileSync(process.execPath, ['--check', `extension/${file}`]);
}
console.log('Manifest resources and JavaScript syntax OK');
