import ts from 'typescript';
import { readdir, rm, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';

const root = resolve(import.meta.dirname, '..');
process.chdir(root);
const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
for (const source of program.getSourceFiles()) {
  if (!parsed.fileNames.includes(source.fileName)) continue;
  const fail = (node, message) => diagnostics.push({ category: ts.DiagnosticCategory.Error, code: 90001, file: source, start: node.getStart(source), length: node.getWidth(source), messageText: message });
  function visit(node) {
    if (node.kind === ts.SyntaxKind.AnyKeyword || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ((ts.isPropertyDeclaration(node) || ts.isVariableDeclaration(node)) && node.exclamationToken)) fail(node, '禁止 any、类型断言和非空/确定赋值断言');
    for (const range of ts.getLeadingCommentRanges(source.text, node.pos) || []) {
      if (/@ts-(ignore|expect-error|nocheck)|eslint-disable/.test(source.text.slice(range.pos, range.end))) fail(node, '禁止使用注释关闭类型检查');
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: file => file, getCurrentDirectory: () => root, getNewLine: () => '\n' }));
  process.exit(1);
}
if (process.argv.includes('--check')) {
  console.log(`Strict TypeScript and safety checks OK (${parsed.fileNames.length} source files)`);
} else {
  async function clean(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await clean(path);
      else if (/\.(?:js|js\.map|ts|ts\.map)$/.test(entry.name)) await rm(path);
    }
  }
  await clean(resolve(root, 'extension'));
  const result = program.emit();
  if (result.emitSkipped || result.diagnostics.length) throw new Error('TypeScript emit failed');
  // Classic injection entry points must remain scripts, without module markers.
  for (const file of ['collector.js', 'badge-observer.js', 'source-highlights.js']) {
    const source = ts.createSourceFile(file, await readFile(resolve(root, 'extension', file), 'utf8'), ts.ScriptTarget.Latest, true);
    if (ts.isExternalModule(source)) throw new Error(`Injection must be a classic script: ${file}`);
  }
  console.log(`Built ${relative(root, parsed.options.outDir)} from strict TypeScript`);
}
