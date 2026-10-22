import { readdir, readFile, access } from 'node:fs/promises';
import { resolve, dirname, relative, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const root = resolve('extension');
async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else result.push(path);
  }
  return result;
}
async function resource(reference, from = resolve(root, 'manifest.json')) {
  if (!reference || /^(?:data:|blob:|https?:|#)/.test(reference)) return;
  const path = resolve(dirname(from), reference.split(/[?#]/)[0]);
  if (relative(root, path).startsWith('..')) throw new Error(`Resource outside extension: ${reference}`);
  await access(path);
}
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
for (const file of [manifest.options_ui.page, manifest.side_panel.default_path, manifest.background.service_worker,
  ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon),
  ...(manifest.content_scripts || []).flatMap(script => [...(script.js || []), ...(script.css || [])])]) await resource(file);
for (const path of await files(root)) {
  const text = ['.js', '.html', '.css'].includes(extname(path)) ? await readFile(path, 'utf8') : '';
  if (path.endsWith('.js')) {
    execFileSync(process.execPath, ['--check', path]);
    const tree = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const references = [];
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) references.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        const name = node.expression.getText(tree);
        if (name === 'import') references.push(node.arguments[0].text);
        if (name === 'chrome.runtime.getURL') references.push('/' + node.arguments[0].text);
      }
      if (ts.isPropertyAssignment(node) && node.name.getText(tree) === 'files' && ts.isArrayLiteralExpression(node.initializer)) {
        for (const value of node.initializer.elements) if (ts.isStringLiteral(value)) references.push('/' + value.text);
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
    for (const value of references) await resource(value.startsWith('/') ? '.' + value : value, value.startsWith('/') ? resolve(root, 'manifest.json') : path);
  } else if (path.endsWith('.html')) {
    for (const match of text.matchAll(/<(?:script|link|img)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi)) await resource(match[1], path);
  } else if (path.endsWith('.css')) {
    for (const match of text.matchAll(/url\(["']?([^)'"\s]+)["']?\)/g)) await resource(match[1], path);
  }
}
console.log('Manifest, modules, HTML, CSS, injection and worker resources OK');
