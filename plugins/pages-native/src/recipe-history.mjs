import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync, rmSync, openSync, fstatSync, closeSync, constants } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { NativeError } from './bridge.mjs';
import { revision } from './text-edits.mjs';
import { copyNativePrototype, nativeFingerprint } from './native-files.mjs';
import { recipeName, storedRecipe } from './recipe-schemas.mjs';
const fail = (code, message, details) => { throw new NativeError(code, message, details); };
const entrySchema = z.strictObject({ schema_version: z.literal(1), name: recipeName, version: z.number().int().positive(), operation: z.enum(['save', 'restore', 'delete', 'import']), archived_at: z.iso.datetime(), restored_from: z.number().int().positive().optional(), recipe: storedRecipe, recipe_digest: z.string().regex(/^[a-f0-9]{64}$/), prototype_available: z.boolean(), unavailable_reason: z.enum(['source_changed', 'source_unavailable']).optional() });
export function historyLocations(library, name) {
  const root = join(library, '.pages-native-history');
  return { root, recipes: join(root, 'recipes'), entries: join(root, 'recipes', name), sources: join(root, 'sources') };
}
function safeDir(path, create = false) {
  if (!existsSync(path)) { if (!create) return false;mkdirSync(path, { mode: 0o700 }); }
  if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) fail('INVALID_HISTORY', 'History paths must be ordinary directories, without symlinks.');return true;
}
function dirs(library, name, create = false) {
  const p = historyLocations(library, name);
  if (!safeDir(library)) return { ...p, exists: false };
  for (const dir of (create ? [p.root, p.recipes, p.entries, p.sources] : [p.root, p.recipes, p.entries])) if (!safeDir(dir, create)) return { ...p, exists: false };
  if (!create && existsSync(p.sources)) safeDir(p.sources);
  return { ...p, exists: true };
}
export function rawHistoryVersions(library, name) {
  const p = dirs(library, name);
  if (!p.exists) return [];
  const entries = readdirSync(p.entries).filter(n => /^[1-9][0-9]{0,15}\.json$/.test(n)).map(n => Number(n.slice(0, -5))).sort((a, b) => a - b);
  if (entries.length > 1000 || entries.some(n => !Number.isSafeInteger(n))) fail('HISTORY_LIMIT', 'History supports at most 1,000 revisions per recipe.');
  return entries;
}
export function historyHead(library, name) {
  const p = dirs(library, name), path = join(p.entries, 'head.json');
  if (!p.exists || !existsSync(path)) return null;
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink() || lstatSync(path).size > 100000) fail('INVALID_HISTORY', 'Invalid history commit pointer.');
  let head;try { head = JSON.parse(readFileSync(path, 'utf8')); } catch { fail('INVALID_HISTORY', 'Cannot decode the history commit pointer.'); }
  if (head.schema_version !== 1 || !Array.isArray(head.versions) || !head.versions.length || head.versions.length > 1000 || head.versions.some((v, i) => !Number.isSafeInteger(v) || v < 1 || (i && v <= head.versions[i - 1])) || head.version !== head.versions.at(-1) || !(head.active_revision === null || /^[a-f0-9]{64}$/.test(head.active_revision))) fail('INVALID_HISTORY', 'Invalid history commit pointer.');
  return head;
}
export function historyVersions(library, name) {
  const head = historyHead(library, name);if (head) return head.versions;
  // Pre-history imports can exist before the first managed commit. Only a
  // matching active definition proves such a revision actually existed.
  const path = join(library, `${name}.json`), p = dirs(library, name);
  if (!p.exists || !existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink() || lstatSync(path).size > 1024 * 1024) return [];
  try {
    const recipe = storedRecipe.parse(JSON.parse(readFileSync(path, 'utf8'))), entryPath = join(p.entries, `${recipe.version}.json`);
    if (!existsSync(entryPath) || !lstatSync(entryPath).isFile() || lstatSync(entryPath).isSymbolicLink() || lstatSync(entryPath).size > 2 * 1024 * 1024) return [];
    const entry = JSON.parse(readFileSync(entryPath, 'utf8'));
    return entry.recipe_digest === revision(recipe) ? [recipe.version] : [];
  } catch { return []; }
}
export function commitHistory(library, name, versions, activeRevision) {
  const p = dirs(library, name, true), stage = join(p.entries, `.head-${randomUUID()}.tmp`);
  try {
    writeFileSync(stage, JSON.stringify({ schema_version: 1, version: versions.at(-1), versions, active_revision: activeRevision }) + '\n', { flag: 'wx', mode: 0o600 });
    renameSync(stage, join(p.entries, 'head.json'));
  } finally { if (existsSync(stage)) rmSync(stage, { force: true }); }
}
export function readHistory(library, name, version) {
  const p = dirs(library, name), path = join(p.entries, `${version}.json`);let fd;
  if (!p.exists) fail('HISTORY_NOT_FOUND', 'No history is recorded for this recipe.');
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) fail('INVALID_HISTORY', 'History records must be ordinary bounded JSON files.');
    const bytes = readFileSync(fd), entry = entrySchema.parse(JSON.parse(bytes.toString('utf8')));
    if (entry.name !== name || entry.version !== version || entry.recipe.name !== name || entry.recipe.version !== version || entry.recipe_digest !== revision(entry.recipe)) fail('HISTORY_CORRUPT', 'Historical recipe identity or integrity differs from its record.');
    return { path, entry, recipe: entry.recipe, revision: revision(bytes.toString('utf8')) };
  } catch (e) {
    if (e.code === 'ENOENT') fail('HISTORY_NOT_FOUND', 'No such historical recipe revision.', { version });
    if (e instanceof NativeError) throw e;
    fail('INVALID_HISTORY', 'Cannot read this history revision.');
  } finally { if (fd !== undefined) closeSync(fd); }
}
export function historicalPrototype(library, record) {
  const { recipe, entry } = record;
  if (!historyVersions(library, recipe.name).includes(entry.version)) fail('HISTORY_UNCOMMITTED', 'This archived candidate did not complete its library commit. Inspect the library state.');
  if (entry.operation === 'delete') fail('HISTORY_DELETED', 'This is a deletion event. Select a saved recipe revision.');
  if (!entry.prototype_available) fail('HISTORY_SOURCE_UNAVAILABLE', 'The older definition was imported without its original prototype; its bytes could not be recovered.');
  const p = dirs(library, recipe.name), source = join(p.sources, `${recipe.source.sha256}.pages`);
  try { if (nativeFingerprint(source) !== recipe.source.sha256) fail('HISTORY_CORRUPT', 'The archived prototype fingerprint changed.'); }
  catch (e) { if (e instanceof NativeError) throw e;fail('HISTORY_SOURCE_UNAVAILABLE', 'The archived prototype is missing or unreadable.'); }
  return source;
}
export function archivePrototype(library, recipe, source, { optional = false } = {}) {
  const p = dirs(library, recipe.name, true), destination = join(p.sources, `${recipe.source.sha256}.pages`);
  if (existsSync(destination)) {
    if (nativeFingerprint(destination) !== recipe.source.sha256) fail('HISTORY_CORRUPT', 'An existing archived prototype differs from its recorded fingerprint.');return { available: true };
  }
  let hash;
  try { hash = source && nativeFingerprint(source); }
  catch (e) { if (!optional) throw e;return { available: false, reason: 'source_unavailable' }; }
  if (hash !== recipe.source.sha256) {
    if (optional) return { available: false, reason: source ? 'source_changed' : 'source_unavailable' };
    fail('REVISION_CHANGED', 'The prototype changed before archival. Preview again.');
  }
  const stage = join(p.sources, `.stage-${randomUUID()}.pages`);
  try {
    copyNativePrototype(source, stage);
    if (nativeFingerprint(source) !== hash || nativeFingerprint(stage) !== hash) fail('COPY_VERIFICATION_FAILED', 'Prototype archival verification failed.');
    renameSync(stage, destination);
  } finally { if (existsSync(stage)) rmSync(stage, { recursive: true, force: true }); }
  return { available: true };
}
export function appendHistory(library, recipe, operation, prototype, restoredFrom) {
  const versions = rawHistoryVersions(library, recipe.name), p = dirs(library, recipe.name, true);
  if (versions.includes(recipe.version)) fail('HISTORY_CONFLICT', 'This immutable history revision already exists.');
  if (versions.length >= 1000) fail('HISTORY_LIMIT', 'History is full; no revisions are removed automatically.');
  const entry = entrySchema.parse({ schema_version: 1, name: recipe.name, version: recipe.version, operation, archived_at: new Date().toISOString(), recipe, recipe_digest: revision(recipe), prototype_available: prototype.available, ...(!prototype.available ? { unavailable_reason: prototype.reason } : {}), ...(restoredFrom ? { restored_from: restoredFrom } : {}) });
  const path = join(p.entries, `${recipe.version}.json`);
  writeFileSync(path, JSON.stringify(entry, null, 2) + '\n', { flag: 'wx', mode: 0o400 });
  return readHistory(library, recipe.name, recipe.version);
}
export function recipeHistory(library, name, version, compareVersion) {
  if (version === undefined) {
    if (compareVersion !== undefined) fail('HISTORY_VERSION_REQUIRED', 'Select version before comparing it.');
    const versions = historyVersions(library, name);
    return { name, uncommitted_versions: rawHistoryVersions(library, name).filter(v => !versions.includes(v)), versions: versions.map(v => { const r = readHistory(library, name, v);return { version: v, operation: r.entry.operation, archived_at: r.entry.archived_at, prototype_available: r.entry.prototype_available, source_sha256: r.recipe.source.sha256, revision: r.revision, ...(r.entry.restored_from ? { restored_from: r.entry.restored_from } : {}) }; }) };
  }
  const selected = readHistory(library, name, version);
  if (compareVersion === undefined) return { ...selected, committed: historyVersions(library, name).includes(version) };
  const other = readHistory(library, name, compareVersion), a = new Map(selected.recipe.fields.map(f => [f.name, f])), b = new Map(other.recipe.fields.map(f => [f.name, f]));
  return { from_version: version, to_version: compareVersion, description_changed: selected.recipe.description !== other.recipe.description, prototype_changed: selected.recipe.source.sha256 !== other.recipe.source.sha256, fields: { added: [...b.keys()].filter(n => !a.has(n)), removed: [...a.keys()].filter(n => !b.has(n)), changed: [...a.keys()].filter(n => b.has(n) && revision(a.get(n)) !== revision(b.get(n))) } };
}
