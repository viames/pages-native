import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PagesTools } from '../plugins/pages-native/src/tools.mjs';
import { revision } from '../plugins/pages-native/src/text-edits.mjs';
import { nativeFingerprint } from '../plugins/pages-native/src/native-files.mjs';
async function fixture(fn) {
  const folder = mkdtempSync(join(tmpdir(), 'pages-history-batch-')), source_path = join(folder, 'model.pages'), library_path = join(folder, 'recipes');writeFileSync(source_path, 'opaque-v1');
  const calls = [], docs = [{ document_id: 'source', path: source_path, modified: false }];
  let failures = new Set(), timeout = false, count = 0, manuallyModified = false;
  const native = async (action, args) => {
    calls.push({ action, args });
    if (action === 'documents') return { documents: structuredClone(docs) };
    if (action === 'text_snapshot') return { text: '{{name}}', characters: Array.from('{{name}}'), paragraphs: ['{{name}}'] };
    if (action === 'open') {
      const doc = { document_id: `copy-${++count}`, path: args.path, modified: false };docs.push(doc);return doc;
    }
    if (action === 'close') { const i = docs.findIndex(d => d.document_id === args.document_id);if (i >= 0) docs.splice(i, 1);return {}; }
    if (action === 'text_apply') {
      const doc = docs.find(d => d.document_id === args.document_id);
      if ([...failures].some(name => doc.path.endsWith(name))) throw Object.assign(Error('Synthetic native failure'), { code: timeout ? 'NATIVE_TIMEOUT' : 'TEXT_POSTCHECK_FAILED' });
      return { text: args.edits[0].text };
    }
    if (action === 'save') { if (manuallyModified) docs.find(d => d.document_id === args.document_id).modified = true;return {}; }
    if (action === 'placeholders') return { placeholders: [] };
    throw Error(action);
  };
  const service = new PagesTools({ exclusive: fn => fn({ call: native }) }, { roots: [] });
  const run = (tool, args = {}) => service.execute(`pages_${tool}`, { library_path, name: 'letters', ...args });
  const definition = { source_path, fields: [{ name: 'name', bindings: [{ kind: 'text', find: '{{name}}' }] }] };
  const mutate = async (args = {}) => { const a = { operation: 'save', recipe: definition, ...args };const p = await run('recipe', a);return run('recipe', { ...a, mode: 'apply', expected_revision: p.revision }); };
  const items = ['a', 'b', 'c'].map(id => ({ id, path: join(folder, `${id}.pages`), values: [{ name: 'name', value: `Recipient ${id}` }] }));
  try { await fn({ folder, source_path, library_path, run, mutate, definition, items, calls, docs, fail: (names, uncertain = false) => { failures = new Set(names);timeout = uncertain; }, manual: () => { manuallyModified = true; } }); }
  finally { rmSync(folder, { recursive: true, force: true }); }
}

test('history preserves exact prototype generations, diffs, deletion events and monotonic restoration', () => fixture(async f => {
  await f.mutate();writeFileSync(f.source_path, 'opaque-v2');
  await f.mutate({ recipe: { ...f.definition, description: 'second', fields: [...f.definition.fields, { name: 'optional', required: false, bindings: [{ kind: 'text', find: 'optional' }] }] } });
  const h = await f.run('recipe_history');assert.deepEqual(h.versions.map(v => v.version), [1, 2]);assert.ok(h.versions.every(v => v.prototype_available));
  const diff = await f.run('recipe_history', { version: 1, compare_version: 2 });assert.equal(diff.prototype_changed, true);assert.deepEqual(diff.fields.added, ['optional']);assert.equal(diff.description_changed, true);
  await f.mutate({ operation: 'delete', recipe: undefined });assert.equal(existsSync(join(f.library_path, 'letters.json')), false);
  const restored = await f.mutate({ operation: 'restore', recipe: undefined, version: 1 });assert.equal(restored.recipe.version, 4);assert.equal(restored.restored_from, 1);
  const archived = join(f.library_path, restored.recipe.source.path);assert.equal(readFileSync(archived, 'utf8'), 'opaque-v1');assert.equal(readFileSync(f.source_path, 'utf8'), 'opaque-v2');
  assert.deepEqual((await f.run('recipe_history')).versions.map(v => v.operation), ['save', 'save', 'delete', 'restore']);
}));

test('historical composition survives removal of the original prototype and relocation of the entire library', () => fixture(async f => {
  await f.mutate();rmSync(f.source_path);
  const moved = join(f.folder, 'moved');cpSync(f.library_path, moved, { recursive: true });
  const input = { library_path: moved, name: 'letters', version: 1, path: join(f.folder, 'historical.pages'), values: [{ name: 'name', value: 'Historical recipient' }] };
  const p = await f.run('compose_recipe', input);assert.equal(p.recipe.history_version, 1);
  const result = await f.run('compose_recipe', { ...input, mode: 'apply', expected_revision: p.revision });assert.equal(result.source_preserved, true);
  assert.equal(readFileSync(input.path, 'utf8'), 'opaque-v1');
}));

test('legacy recipes preserve available definitions but do not invent lost pre-history prototype bytes', () => fixture(async f => {
  mkdirSync(f.library_path);
  const legacy = { schema_version: 1, name: 'letters', version: 7, description: '', source: { path: '../model.pages', sha256: nativeFingerprint(f.source_path) }, fields: [{ name: 'name', required: true, bindings: [{ kind: 'text', target: { kind: 'body' }, find: '{{name}}', expected_count: 1 }] }] };
  writeFileSync(join(f.library_path, 'letters.json'), JSON.stringify(legacy));writeFileSync(f.source_path, 'new bytes');
  await f.mutate();const h = await f.run('recipe_history');assert.deepEqual(h.versions.map(v => v.version), [7, 8]);assert.equal(h.versions[0].prototype_available, false);
  await assert.rejects(f.mutate({ operation: 'restore', recipe: undefined, version: 7 }), e => e.code === 'HISTORY_SOURCE_UNAVAILABLE');
}));

test('history guards reject tampered prototypes and active definitions without changing the archived past', () => fixture(async f => {
  await f.mutate();const h = await f.run('recipe_history', { version: 1 });
  const file = join(f.library_path, '.pages-native-history/sources', `${h.recipe.source.sha256}.pages`);writeFileSync(file, 'corrupted');
  await assert.rejects(f.run('compose_recipe', { version: 1, path: join(f.folder, 'bad.pages'), values: [{ name: 'name', value: 'x' }] }), e => e.code === 'HISTORY_CORRUPT');
  const active = join(f.library_path, 'letters.json'), value = JSON.parse(readFileSync(active));value.description = 'external';writeFileSync(active, JSON.stringify(value));
  await assert.rejects(f.run('recipes'), e => e.code === 'HISTORY_CONFLICT');
}));

test('batch preflights all records and rejects duplicate destinations, invalid fields and stale requests before creating output', () => fixture(async f => {
  await f.mutate();const p = await f.run('compose_batch', { items: f.items });assert.equal(p.item_count, 3);assert.ok(f.items.every(i => !existsSync(i.path)));
  await assert.rejects(f.run('compose_batch', { items: [f.items[0], { ...f.items[1], values: [] }] }), e => e.code === 'BATCH_PREFLIGHT_FAILED' && e.details.item_id === 'b');
  await assert.rejects(f.run('compose_batch', { items: [f.items[0], { ...f.items[1], path: f.items[0].path.toUpperCase() }] }));
  await assert.rejects(f.run('compose_batch', { items: f.items, on_error: 'continue', mode: 'apply', expected_revision: p.revision }), e => e.code === 'REVISION_CHANGED');
  assert.ok(f.items.every(i => !existsSync(i.path)));
}));

test('batch creates independent native outputs, reports outcomes and closes only its saved unmodified documents', () => fixture(async f => {
  await f.mutate();const p = await f.run('compose_batch', { items: f.items });
  const result = await f.run('compose_batch', { items: f.items, mode: 'apply', expected_revision: p.revision });
  assert.equal(result.completed, 3);assert.equal(result.failed, 0);assert.equal(result.transactional, false);assert.ok(result.results.every(r => r.closed));
  assert.ok(f.items.every(i => existsSync(i.path)));assert.ok(f.docs.some(d => d.document_id === 'source'));
}));

test('batch stop and explicit continue retain partial copies and never retry failed records', () => fixture(async f => {
  await f.mutate();f.fail(['b.pages']);const p = await f.run('compose_batch', { items: f.items });
  const stopped = await f.run('compose_batch', { items: f.items, mode: 'apply', expected_revision: p.revision });assert.equal(stopped.completed, 1);assert.equal(stopped.failed, 1);assert.equal(stopped.not_attempted, 1);assert.equal(existsSync(f.items[2].path), false);
  const other = f.items.map(i => ({ ...i, path: join(f.folder, `next-${i.id}.pages`) }));f.fail(['next-b.pages']);
  const preview = await f.run('compose_batch', { items: other, on_error: 'continue' });
  const continued = await f.run('compose_batch', { items: other, on_error: 'continue', mode: 'apply', expected_revision: preview.revision });assert.equal(continued.completed, 2);assert.equal(continued.failed, 1);assert.equal(continued.not_attempted, 0);
  assert.equal(f.calls.filter(c => c.action === 'text_apply' && c.args.edits[0].text === 'Recipient b').length, 2); // once in each distinct batch, never retried.
}));

test('uncertain native failures stop even continue batches and manually modified outputs are left open', () => fixture(async f => {
  await f.mutate();f.fail(['b.pages'], true);const p = await f.run('compose_batch', { items: f.items, on_error: 'continue' });
  const result = await f.run('compose_batch', { items: f.items, on_error: 'continue', mode: 'apply', expected_revision: p.revision });assert.equal(result.not_attempted, 1);assert.equal(result.stopped, true);
  const item = { ...f.items[0], path: join(f.folder, 'manual.pages') };f.fail([]);f.manual();const preview = await f.run('compose_batch', { items: [item] });
  const modified = await f.run('compose_batch', { items: [item], mode: 'apply', expected_revision: preview.revision });assert.equal(modified.results[0].close_state, 'left_open_modified');assert.equal(modified.results[0].closed, false);
}));


test('uncommitted archive candidates are visible as such and cannot be composed or restored', () => fixture(async f => {
  await f.mutate();const first = await f.run('recipe_history', { version: 1 });
  const candidate = { ...first.entry, version: 2, recipe: { ...first.recipe, version: 2 } };candidate.recipe_digest = revision(candidate.recipe);
  writeFileSync(join(f.library_path, '.pages-native-history/recipes/letters/2.json'), JSON.stringify(candidate));
  const h = await f.run('recipe_history');assert.deepEqual(h.uncommitted_versions, [2]);assert.deepEqual(h.versions.map(v => v.version), [1]);
  await assert.rejects(f.run('compose_recipe', { version: 2, path: join(f.folder, 'candidate.pages'), values: [{ name: 'name', value: 'x' }] }), e => e.code === 'HISTORY_UNCOMMITTED');
  await assert.rejects(f.mutate({ operation: 'restore', recipe: undefined, version: 2 }), e => e.code === 'HISTORY_UNCOMMITTED');
  const saved = await f.mutate();assert.equal(saved.recipe.version, 3);assert.deepEqual((await f.run('recipe_history')).versions.map(v => v.version), [1, 3]);
}));
