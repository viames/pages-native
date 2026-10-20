import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, realpathSync, rmSync, cpSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { PagesTools } from '../plugins/pages-native/src/tools.mjs';
import { resolveRecipe } from '../plugins/pages-native/src/recipes.mjs';
import { canonicalPath } from '../plugins/pages-native/src/paths.mjs';
async function fixture(fn) {
  const folder = mkdtempSync(join(tmpdir(), 'pages-recipes-'));
  const source_path = join(folder, 'model.pages'), library_path = join(folder, 'recipes');writeFileSync(source_path, 'opaque native prototype');
  let nativeCalls = 0;
  const service = new PagesTools({ exclusive: () => { nativeCalls++;throw Error('Library operations must not call Pages.'); } }, { roots: [folder] });
  const run = (tool, args) => service.execute(`pages_${tool}`, { library_path, ...args });
  const recipe = { source_path, fields: [{ name: 'cliente', bindings: [{ kind: 'text', find: '{{cliente}}' }] }, { name: 'importo', default: 0, bindings: [{ kind: 'cell', table: 1, table_name: 'Dati', address: 'B2' }] }] };
  try { await fn({ folder, source_path, library_path, recipe, run, nativeCalls: () => nativeCalls }); }
  finally { rmSync(folder, { recursive: true, force: true }); }
}
async function save(f, extra = {}) {
  const args = { name: 'contratto', operation: 'save', recipe: f.recipe, ...extra };
  const p = await f.run('recipe', args);
  return f.run('recipe', { ...args, mode: 'apply', expected_revision: p.revision });
}

test('recipe library preview creates nothing; save/list/read versions definitions without opening Pages', () => fixture(async f => {
  const p = await f.run('recipe', { name: 'contratto', operation: 'save', recipe: f.recipe });
  assert.equal(existsSync(f.library_path), false);assert.equal(p.after.version, 1);
  const first = await save(f);assert.equal(first.recipe.version, 1);assert.equal(isAbsolute(first.recipe.source.path), false);
  const listed = await f.run('recipes', {});assert.equal(listed.recipes[0].field_count, 2);
  const second = await save(f, { recipe: { ...f.recipe, description: 'Updated' } });assert.equal(second.recipe.version, 2);
  assert.equal((await f.run('recipes', { name: 'contratto' })).recipe.description, 'Updated');
  await assert.rejects(save(f, { recipe: { ...f.recipe, fields: [{ ...f.recipe.fields[0], value: 'recipient data' }] } }));
  assert.equal(f.nativeCalls(), 0);
}));

test('recipe mutations reject changed source bytes, changed requests and stale overwrite/delete revisions', () => fixture(async f => {
  await save(f);
  const args = { name: 'contratto', operation: 'save', recipe: f.recipe };
  const p = await f.run('recipe', args);
  await save(f, { recipe: { ...f.recipe, description: 'Concurrent change' } });
  await assert.rejects(f.run('recipe', { ...args, mode: 'apply', expected_revision: p.revision }), e => e.code === 'REVISION_CHANGED');
  const fresh = await f.run('recipe', args);writeFileSync(f.source_path, 'changed native prototype');
  await assert.rejects(f.run('recipe', { ...args, mode: 'apply', expected_revision: fresh.revision }), e => e.code === 'REVISION_CHANGED');
  const d = await f.run('recipe', { name: 'contratto', operation: 'delete' });assert.equal(existsSync(join(f.library_path, 'contratto.json')), true);
  const removed = await f.run('recipe', { name: 'contratto', operation: 'delete', mode: 'apply', expected_revision: d.revision });assert.equal(removed.deleted, true);
  await assert.rejects(f.run('recipe', { name: 'contratto', operation: 'delete', mode: 'apply', expected_revision: d.revision }), e => e.code === 'RECIPE_NOT_FOUND');
}));

test('recipe definitions reject duplicate fields/cells, mixed text/tag scopes and invalid typed defaults', () => fixture(async f => {
  for (const fields of [
    [f.recipe.fields[0], f.recipe.fields[0]],
    [f.recipe.fields[1], { ...f.recipe.fields[1], name: 'other' }],
    [f.recipe.fields[0], { name: 'tag', bindings: [{ kind: 'placeholder', tag: 'tag' }] }],
    [{ ...f.recipe.fields[0], default: 12 }],
    [{ name: 'large', default: 'x'.repeat(10001), bindings: f.recipe.fields[1].bindings }]
  ]) { await assert.rejects(f.run('recipe', { name: 'bad', operation: 'save', recipe: { ...f.recipe, fields } }));assert.equal(existsSync(f.library_path), false); }
}));

test('library JSON and native prototype relocate together; explicit source override accepts only identical saved bytes', () => fixture(async f => {
  await save(f);const relocated = join(f.folder, 'relocated');mkdirSync(relocated);
  cpSync(f.source_path, join(relocated, 'model.pages'));cpSync(f.library_path, join(relocated, 'recipes'), { recursive: true });
  const resolve = (library_path, extra = {}) => resolveRecipe({ library_path, name: 'contratto', values: [{ name: 'cliente', value: 'Viames' }], ...extra }, canonicalPath);
  const moved = resolve(join(relocated, 'recipes'));assert.equal(moved.fields[0].value, 'Viames');assert.equal(moved.fields[1].default, 0);
  assert.equal(moved.source_path, realpathSync(join(relocated, 'model.pages')));
  assert.ok(resolve(f.library_path, { source_path: join(relocated, 'model.pages') }));
  writeFileSync(join(relocated, 'model.pages'), 'different');
  assert.throws(() => resolve(f.library_path, { source_path: join(relocated, 'model.pages') }), e => e.code === 'RECIPE_SOURCE_CHANGED');
  assert.throws(() => resolve(f.library_path, { values: [{ name: 'unknown', value: 'x' }] }), e => e.code === 'UNKNOWN_FIELD');
  assert.throws(() => resolve(f.library_path, { values: [{ name: 'cliente', value: 'a' }, { name: 'cliente', value: 'b' }] }), e => e.code === 'DUPLICATE_FIELD');
}));

test('invalid/symlink library entries are reported without following them or corrupting valid recipes', () => fixture(async f => {
  await save(f);
  writeFileSync(join(f.library_path, 'broken.json'), 'not json');symlinkSync(f.source_path, join(f.library_path, 'linked.json'));
  const result = await f.run('recipes', {});assert.equal(result.recipes.length, 1);assert.equal(result.invalid.length, 2);
  await assert.rejects(f.run('recipes', { name: 'linked' }), e => e.code === 'INVALID_RECIPE');
  await assert.rejects(f.run('recipe', { name: '../escape', operation: 'save', recipe: f.recipe }));
  assert.equal(readFileSync(f.source_path, 'utf8'), 'opaque native prototype');
}));

test('recipe library locking rejects concurrent writers without overwriting a definition', () => fixture(async f => {
  const first = await save(f);mkdirSync(join(f.library_path, '.pages-native-recipes.lock'));
  const p = await f.run('recipe', { name: 'contratto', operation: 'save', recipe: f.recipe });
  await assert.rejects(f.run('recipe', { name: 'contratto', operation: 'save', recipe: f.recipe, mode: 'apply', expected_revision: p.revision }), e => e.code === 'LIBRARY_BUSY');
  assert.equal((await f.run('recipes', { name: 'contratto' })).revision, first.revision);
}));


test('compose_recipe binds the saved recipe revision and rejects unknown values before native writes', () => fixture(async f => {
  await save(f, { recipe: { ...f.recipe, fields: [f.recipe.fields[0]] } });
  const calls = [];
  const service = new PagesTools({ exclusive: fn => fn({ async call(action, args) {
    calls.push(action);
    if (action === 'documents') return { documents: [{ document_id: 'source', path: f.source_path, modified: false }] };
    if (action === 'text_snapshot') return { text: '{{cliente}}', characters: Array.from('{{cliente}}'), paragraphs: ['{{cliente}}'] };
    throw Error(action);
  } }) }, { roots: [f.folder] });
  const input = { library_path: f.library_path, name: 'contratto', path: join(f.folder, 'result.pages'), values: [{ name: 'cliente', value: 'Viames' }] };
  const p = await service.execute('pages_compose_recipe', input);assert.equal(p.recipe.version, 1);assert.equal(p.targets[0].after, 'Viames');
  await save(f, { recipe: { ...f.recipe, description: 'new version', fields: [f.recipe.fields[0]] } });
  await assert.rejects(service.execute('pages_compose_recipe', { ...input, mode: 'apply', expected_revision: p.revision }), e => e.code === 'REVISION_CHANGED');
  await assert.rejects(service.execute('pages_compose_recipe', { ...input, values: [{ name: 'typo', value: 'x' }] }), e => e.code === 'UNKNOWN_FIELD');
  assert.equal(existsSync(input.path), false);assert.ok(calls.every(c => ['documents', 'text_snapshot'].includes(c)));
}));
