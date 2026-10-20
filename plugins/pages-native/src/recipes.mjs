import { existsSync, lstatSync, mkdirSync, openSync, fstatSync, readFileSync, closeSync, writeFileSync, renameSync, unlinkSync, readdirSync, constants, rmSync, copyFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { NativeError } from './bridge.mjs';
import { revision } from './text-edits.mjs';
import { nativeFingerprint } from './native-files.mjs';
import { storedRecipe, cellValue } from './recipe-schemas.mjs';
import { parseRange } from './paths.mjs';
import { historyVersions, rawHistoryVersions, historyHead, commitHistory, readHistory, archivePrototype, appendHistory, historicalPrototype } from './recipe-history.mjs';
const fail = (code, message, details) => { throw new NativeError(code, message, details); };
export function validateDefinitions(fields) {
  const names = new Set(), cells = new Set(), modes = new Set(), scopes = new Set();let count = 0;
  for (const f of fields) {
    if (names.has(f.name)) fail('DUPLICATE_FIELD', 'Field names must be unique.');names.add(f.name);
    for (const b of f.bindings) {
      count += b.kind === 'cell' ? 1 : b.expected_count;
      if (b.kind === 'cell') {
        parseRange(b.address);
        const key = `${b.table}:${b.address}`;
        if (cells.has(key)) fail('OVERLAPPING_BINDINGS', 'Map each native cell only once.');cells.add(key);
        if (typeof f.default === 'boolean') fail('UNSUPPORTED_NATIVE_API', 'Pages does not retain boolean cell values or support checkbox controls. Use an explicit numeric or text default.');
        if (f.default !== undefined) cellValue.parse(f.default);
      } else {
        modes.add(b.kind);
        if (f.default !== undefined && typeof f.default !== 'string') fail('FIELD_TYPE', 'Text and placeholder defaults must be literal strings.');
        if (b.kind === 'text' && ['body', 'section', 'page'].includes(b.target.kind)) scopes.add(JSON.stringify(b.target));
      }
    }
  }
  if (count > 200) fail('COMPOSITION_LIMIT', 'A reusable recipe supports at most 200 declared replacements.');
  if (modes.size > 1) fail('MIXED_BINDINGS', 'Use literal text OR native placeholder tags; either can be combined with cells.');
  if (scopes.size > 1) fail('OVERLAPPING_SCOPES', 'Use only one body/section/page scope in a recipe.');
}
function directory(path, allowMissing = false) {
  if (!existsSync(path)) { if (allowMissing) return false;fail('LIBRARY_NOT_FOUND', 'Create a recipe through pages_recipe first, or select an existing library.'); }
  if (!lstatSync(path).isDirectory()) fail('INVALID_LIBRARY', 'The library must be a directory.');return true;
}
export function readRecipe(library, name) {
  directory(library);
  const path = join(library, `${name}.json`);let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 1024 * 1024) fail('INVALID_RECIPE', 'Recipe files must be regular JSON files up to 1 MiB.');
    const bytes = readFileSync(fd), recipe = storedRecipe.parse(JSON.parse(bytes.toString('utf8')));
    const head = historyHead(library, name);
    if (head && (head.active_revision !== revision(bytes.toString('utf8')) || head.version !== recipe.version)) fail('HISTORY_CONFLICT', 'The active recipe differs from its committed history. Inspect external or interrupted writes.');
    if (recipe.name !== name) fail('INVALID_RECIPE', 'The recipe identity does not match its filename.');
    validateDefinitions(recipe.fields);
    return { path, recipe, revision: revision(bytes.toString('utf8')) };
  } catch (e) {
    if (e.code === 'ENOENT' && historyHead(library, name)?.active_revision) fail('HISTORY_CONFLICT', 'The committed active recipe file is missing. Inspect the library.');
    if (e.code === 'ENOENT') fail('RECIPE_NOT_FOUND', 'No recipe has this name.', { name });
    if (e instanceof NativeError) throw e;
    fail('INVALID_RECIPE', 'The recipe is not valid portable Pages Native JSON.', { name });
  } finally { if (fd !== undefined) closeSync(fd); }
}
export function recipes(library, name) {
  if (!directory(library, true)) return { library_path: library, recipes: [], exists: false };
  if (name) return { library_path: library, ...readRecipe(library, name) };
  const entries = readdirSync(library).filter(n => /^[a-z0-9][a-z0-9_-]{0,63}\.json$/.test(n));
  if (entries.length > 1000) fail('LIBRARY_LIMIT', 'A library supports at most 1,000 recipes.');
  const items = [], invalid = [];
  for (const entry of entries.sort()) {
    const name = entry.slice(0, -5);
    try { const { recipe, revision: rev } = readRecipe(library, name);items.push({ name, version: recipe.version, description: recipe.description, source: recipe.source, field_count: recipe.fields.length, revision: rev }); }
    catch (e) { invalid.push({ name, code: e.code }); }
  }
  return { library_path: library, recipes: items, invalid, exists: true };
}
export function changeRecipe(args, pathGuard) {
  const { library_path: library, name, operation, mode, expected_revision } = args;
  const present = directory(library, true), path = join(library, `${name}.json`);
  const head = historyHead(library, name);
  const before = present && (existsSync(path) || head?.active_revision) ? readRecipe(library, name) : null;
  const versions = historyVersions(library, name), rawVersions = rawHistoryVersions(library, name), latest = rawVersions.at(-1) ?? 0;
  const checkCapacity = () => { if (operation !== 'delete' && !before && existsSync(library) && readdirSync(library).filter(n => /^[a-z0-9][a-z0-9_-]{0,63}\.json$/.test(n)).length >= 1000) fail('LIBRARY_LIMIT', 'A library supports at most 1,000 recipes.'); };
  checkCapacity();
  if (operation === 'delete' && !before) fail('RECIPE_NOT_FOUND', 'No recipe has this name.');
  if (operation !== 'restore' && args.version !== undefined) fail('INVALID_ARGUMENT', 'version applies only to restore.');
  const nextVersion = Math.max(before?.recipe.version ?? 0, latest) + 1;
  if (versions.length + (before && !versions.includes(before.recipe.version) ? 1 : 0) >= 1000) fail('HISTORY_LIMIT', 'History is full; no revisions are removed automatically.');
  let after, source, selected;
  if (operation === 'save') {
    if (!args.recipe) fail('RECIPE_REQUIRED', 'Supply a prototype and field definitions.');
    validateDefinitions(args.recipe.fields);
    source = pathGuard(args.recipe.source_path, { extensions: ['.pages'], mustExist: true });
    after = storedRecipe.parse({ schema_version: 1, name, version: nextVersion, description: args.recipe.description, source: { path: relative(library, source), sha256: nativeFingerprint(source) }, fields: args.recipe.fields });
  } else if (operation === 'restore') {
    if (!args.version || args.recipe) fail('INVALID_ARGUMENT', 'Restore requires a historical version and no new recipe definition.');
    selected = readHistory(library, name, args.version);validateDefinitions(selected.recipe.fields);
    source = pathGuard(historicalPrototype(library, selected), { extensions: ['.pages'], mustExist: true });
    after = storedRecipe.parse({ ...selected.recipe, version: nextVersion, source: { ...selected.recipe.source, path: relative(library, source) } });
  } else if (args.recipe) fail('INVALID_ARGUMENT', 'Delete accepts only a library/name and revision.');
  const rev = revision({ library, name, operation, before_revision: before?.revision ?? null, history_versions: versions, raw_versions: rawVersions, restored_revision: selected?.revision ?? null, after: after ?? null });
  if (mode === 'preview') return { mode, revision: rev, before: before?.recipe ?? null, after: after ?? null, history_version: nextVersion, ...(selected ? { restored_from: args.version } : {}), notices: ['Only local recipe JSON and opaque saved prototype copies are changed. Pages is not opened or edited.', 'Every new mutation preserves history; older pre-history definitions can lack original prototype bytes. Restoration creates a new revision rather than overwriting the past.'] };
  if (expected_revision !== rev) fail('REVISION_CHANGED', 'The recipe, history, prototype bytes or request changed. Preview again.');
  if (!present) mkdirSync(library, { mode: 0o700 });
  const lock = join(library, '.pages-native-recipes.lock');
  try { mkdirSync(lock, { mode: 0o700 }); } catch { fail('LIBRARY_BUSY', 'Another recipe mutation holds this library lock.'); }
  let stage, backup;
  try {
    writeFileSync(join(lock, 'pid'), String(process.pid), { mode: 0o600 });checkCapacity();
    const current = existsSync(path) ? readRecipe(library, name).revision : null;
    if (current !== (before?.revision ?? null) || revision(historyVersions(library, name)) !== revision(versions) || revision(rawHistoryVersions(library, name)) !== revision(rawVersions)) fail('REVISION_CHANGED', 'The recipe or history changed before writing.');
    if (before) {
      if (versions.includes(before.recipe.version)) {
        if (revision(readHistory(library, name, before.recipe.version).recipe) !== revision(before.recipe)) fail('HISTORY_CONFLICT', 'The active definition differs from its immutable historical revision. Inspect edits made outside this version of Pages Native.');
      } else {
        let oldSource;
        try { oldSource = pathGuard(resolve(library, before.recipe.source.path), { extensions: ['.pages'], mustExist: true }); } catch {}
        const snapshot = archivePrototype(library, before.recipe, oldSource, { optional: true });
        appendHistory(library, before.recipe, 'import', snapshot);
      }
    }
    const eventRecipe = after ?? { ...before.recipe, version: nextVersion };
    let snapshot;
    if (after) snapshot = archivePrototype(library, after, source);
    else snapshot = archivePrototype(library, eventRecipe, undefined, { optional: true });
    const bytes = after ? JSON.stringify(after, null, 2) + '\n' : undefined;
    if (bytes && Buffer.byteLength(bytes) > 1024 * 1024) fail('RECIPE_LIMIT', 'Store at most 1 MiB per recipe.');
    // Archive first. If publishing the active file fails, remove only this newly
    // created event; saved prototype blobs and imported prior state stay intact.
    const archived = appendHistory(library, eventRecipe, operation, snapshot, selected ? args.version : undefined);
    try {
      if (before) { backup = join(library, `.backup-${randomUUID()}.tmp`);copyFileSync(path, backup, constants.COPYFILE_EXCL); }
      if (after) {
        stage = join(library, `.pages-native-${randomUUID()}.tmp`);
        writeFileSync(stage, bytes, { flag: 'wx', mode: 0o600 });renameSync(stage, path);stage = undefined;
      } else unlinkSync(path);
      commitHistory(library, name, [...new Set([...versions, ...(before ? [before.recipe.version] : []), nextVersion])].sort((a, b) => a - b), after ? revision(bytes) : null);
    } catch (e) {
      try { if (backup) { renameSync(backup, path);backup = undefined; } else if (!before) rmSync(path, { force: true });rmSync(archived.path, { force: true }); }
      catch { fail('LIBRARY_STATE_UNCERTAIN', 'Recipe publication failed and could not be rolled back. Preserve the library and inspect its history before another mutation.'); }
      throw e;
    }
    if (after) return { mode: 'applied', operation, ...readRecipe(library, name), history_version: nextVersion, prototype_archived: snapshot.available, ...(selected ? { restored_from: args.version } : {}) };
    return { mode: 'applied', operation, name, deleted: true, history_version: nextVersion, history_preserved: true };
  } finally { if (stage) rmSync(stage, { force: true });if (backup) rmSync(backup, { force: true });rmSync(lock, { recursive: true }); }
}
export function resolveRecipe(args, pathGuard) {
  const record = args.version === undefined ? readRecipe(args.library_path, args.name) : readHistory(args.library_path, args.name, args.version), { recipe } = record;
  const historicalSource = args.version === undefined ? undefined : historicalPrototype(args.library_path, record);
  validateDefinitions(recipe.fields);
  const source_path = pathGuard(args.source_path ?? historicalSource ?? resolve(args.library_path, recipe.source.path), { extensions: ['.pages'], mustExist: true });
  if (nativeFingerprint(source_path) !== recipe.source.sha256) fail('RECIPE_SOURCE_CHANGED', 'The saved prototype differs from the recipe fingerprint. Review and save a new recipe revision deliberately.');
  const values = new Map();
  for (const entry of args.values) {
    if (values.has(entry.name)) fail('DUPLICATE_FIELD', 'Supply each field value once.');
    if (!recipe.fields.some(f => f.name === entry.name)) fail('UNKNOWN_FIELD', 'No recipe field has this name.', { name: entry.name });
    values.set(entry.name, entry.value);
  }
  return { record, source_path, fields: recipe.fields.map(f => ({ ...f, ...(values.has(f.name) ? { value: values.get(f.name) } : {}) })) };
}

export function verifyRecipeRecord(record) {
  if (record.history_version !== undefined && !historyVersions(record.library_path, record.name).includes(record.history_version)) fail('HISTORY_UNCOMMITTED', 'The selected history revision is not committed.');
  const current = record.history_version === undefined ? readRecipe(record.library_path, record.name) : readHistory(record.library_path, record.name, record.history_version);
  if (current.revision !== record.revision) fail('REVISION_CHANGED', 'The selected recipe changed during composition. Preview again.');
}
