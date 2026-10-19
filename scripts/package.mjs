import { readdirSync, readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { join, relative } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const plugin = 'plugins/pages-native';
cpSync('LICENSE', `${plugin}/LICENSE`);
for (const file of ['PUBLISHING.md', 'VERIFICATION.md', 'CAPABILITIES.md', 'native-verification.json']) cpSync(`docs/${file}`, `${plugin}/docs/${file}`);
mkdirSync(`${plugin}/docs/assets`, { recursive: true });
cpSync('docs/assets/demo.png', `${plugin}/docs/assets/demo.png`);
const version = JSON.parse(readFileSync(`${plugin}/plugin.json`)).version;
if (version !== JSON.parse(readFileSync('package.json')).version) throw new Error('Version mismatch.');
if (version !== JSON.parse(readFileSync(`${plugin}/manifest.json`)).version) throw new Error('MCPB version mismatch.');
mkdirSync('artifacts', { recursive: true });

function files(root, dir = root) {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(e => {
    if (['node_modules', 'artifacts', '.git', '.DS_Store'].includes(e.name)) return [];
    const path = join(dir, e.name);
    if (e.isSymbolicLink()) throw new Error(`Symlinks must not enter the release: ${path}`);
    return e.isDirectory() ? files(root, path) : [path];
  });
}
const crcTable = Array.from({ length: 256 }, (_, i) => {
  for (let k = 0; k < 8; k++) i = i & 1 ? 0xedb88320 ^ (i >>> 1) : i >>> 1;
  return i >>> 0;
});
function crc32(data) { let c = 0xffffffff; for (const b of data) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

// Small deterministic ZIP writer; no packaging-time Python, zip binary or npm download required.
function zip(root, destination) {
  const local = [], central = []; let offset = 0;
  const list = files(root);
  for (const path of list) {
    const name = Buffer.from(relative(root, path).replaceAll('\\', '/'));
    const data = readFileSync(path), compressed = deflateRawSync(data), crc = crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt16LE((46 << 9) | (10 << 5) | 19, 12); // fixed release date: 2026-10-19
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(compressed.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26);
    local.push(h, name, compressed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE((46 << 9) | (10 << 5) | 19, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(compressed.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, name); offset += h.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(list.length, 8); end.writeUInt16LE(list.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  writeFileSync(destination, Buffer.concat([...local, directory, end]));
  return destination;
}
const mcpb = zip(plugin, `artifacts/pages-native-${version}.mcpb`);
const registry = JSON.parse(readFileSync('registry/server.template.json', 'utf8'));
registry.version = version;
registry.packages[0].identifier = `https://github.com/viames/pages-native/releases/download/v${version}/pages-native-${version}.mcpb`;
registry.packages[0].fileSha256 = createHash('sha256').update(readFileSync(mcpb)).digest('hex');
writeFileSync('artifacts/server.json', JSON.stringify(registry, null, 2) + '\n');
const packages = [zip('.', `artifacts/pages-native-${version}-marketplace.zip`), zip(plugin, `artifacts/pages-native-${version}-plugin.zip`), mcpb, 'artifacts/server.json'];
writeFileSync('artifacts/SHA256SUMS', packages.map(path => `${createHash('sha256').update(readFileSync(path)).digest('hex')}  ${path.split('/').pop()}`).join('\n') + '\n');
console.log(packages.join('\n'));
