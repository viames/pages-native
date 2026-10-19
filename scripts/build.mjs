import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const result = await build({
  entryPoints: ['plugins/pages-native/src/server.mjs'],
  outfile: 'plugins/pages-native/dist/server.mjs', bundle: true, platform: 'node', target: 'node22', format: 'esm',
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  legalComments: 'eof', metafile: true
});
writeFileSync('plugins/pages-native/dist/build-meta.json', JSON.stringify(result.metafile, null, 2));

const licenses = [...new Set(Object.keys(result.metafile.inputs).filter(p => p.startsWith('node_modules/')).map(p => {
  const parts = p.split('/');
  return parts[1].startsWith('@') ? parts.slice(1, 3).join('/') : parts[1];
}))].sort();
writeFileSync('plugins/pages-native/THIRD-PARTY-NOTICES.txt', licenses.map(name => {
  let license;
  for (const filename of ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'LICENSE-MIT', 'license']) {
    try { license = readFileSync(`node_modules/${name}/${filename}`, 'utf8'); break; } catch {}
  }
  if (!license) throw new Error(`Missing license for ${name}`);
  const pkg = JSON.parse(readFileSync(`node_modules/${name}/package.json`));
  return `${name} ${pkg.version} (${pkg.license})\n${license}`;
}).join('\n\n'));
console.log('Built bundled MCP server. Runtime requires Node.js 22+; no npm install needed for users.');
