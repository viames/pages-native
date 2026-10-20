import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { literalMatches } from '../plugins/pages-native/src/search.mjs';
import { PagesTools } from '../plugins/pages-native/src/tools.mjs';
const snap = text => ({ text, characters: Array.from(text), paragraphs: [text] });

test('literal search preserves native Unicode boundaries, regex punctuation and case offsets', () => {
  const text = 'İ x 👩🏽‍💻 é [a.b] X';
  const snapshot = { text, characters: ['İ', ' ', 'x', ' ', '👩🏽‍💻', ' ', 'é', ' ', '[', 'a', '.', 'b', ']', ' ', 'X'] };
  assert.equal(literalMatches(snapshot, 'x', false).matches[1].start, 15);
  assert.equal(literalMatches(snapshot, '👩🏽‍💻').matches[0].delete_count, 1);
  assert.equal(literalMatches(snapshot, '🏽').excluded, 1);
  assert.equal(literalMatches(snapshot, 'e').excluded, 1);
  assert.equal(literalMatches(snapshot, '[a.b]').matches.length, 1);
  assert.throws(() => literalMatches({ text: 'ab', characters: ['a'] }, 'a'), e => e.code === 'NATIVE_CHARACTER_MAP');
});

test('search paginates a full scoped read and returns cell references without false native offsets', async () => {
  const calls = [];
  const service = new PagesTools({ exclusive: f => f({ async call(action, args) {
    calls.push(action);
    if (action === 'search_inventory') return { targets: [{ kind: 'body' }], tables: [{ table: 1, name: 'Spese', cells: [[{ address: 'B2', formatted: '150 €', formula: '=SUM(B3:B4)' }]] }] };
    if (action === 'text_snapshot') return snap('150 e 150');
    throw Error(action);
  } }) }, { roots: [] });
  const input = { document_id: 'd', query: '150', max_results: 2 };
  const first = await service.execute('pages_search', input);
  assert.equal(first.total_matches, 3); assert.equal(first.next_offset, 2); assert.equal(first.matches[0].start, 1);
  const second = await service.execute('pages_search', { ...input, offset: 2 });
  assert.equal(second.matches[0].address, 'B2'); assert.equal(second.matches[0].start, undefined); assert.equal(second.next_offset, null);
  const formula = await service.execute('pages_search', { ...input, query: '=SUM', include_formulas: true });
  assert.equal(formula.matches[0].channel, 'formula');
  assert.ok(calls.every(a => ['search_inventory', 'text_snapshot'].includes(a)));
  await assert.rejects(service.execute('pages_search', { ...input, scopes: ['body'], text_targets: [{ kind: 'shape', index: 1 }] }));
});

test('search rejects total text budgets and duplicate scopes rather than claiming complete results', async () => {
  const service = new PagesTools({ exclusive: f => f({ async call(action) {
    if (action === 'search_inventory') return { targets: [{ kind: 'body' }, { kind: 'text', index: 1 }], tables: [] };
    return snap('A'.repeat(60000));
  } }) }, { roots: [] });
  await assert.rejects(service.execute('pages_search', { document_id: 'd', query: 'A' }), e => e.code === 'SEARCH_LIMIT');
  await assert.rejects(service.execute('pages_search', { document_id: 'd', query: 'A', scopes: ['body', 'body'] }), e => e.code === 'DUPLICATE_SCOPE');
});

function fixture() {
  const folder = mkdtempSync(join(tmpdir(), 'pages-composition-')), source_path = join(folder, 'source.pages'), path = join(folder, 'out.pages');
  writeFileSync(source_path, 'opaque native bytes');
  const docs = [{ document_id: 'source', path: source_path, modified: false }], calls = [], bodies = new Map([['source', snap('Titolo\n{{nome}} / {{nome}}\n{{nota}}')]]);
  let corrupt = false, duringRead = false;
  const bridge = { exclusive: f => f({ async call(action, args) {
    calls.push({ action, args });
    if (action === 'documents') return { documents: structuredClone(docs) };
    if (action === 'text_snapshot') { if (duringRead) docs[0].modified = true; return structuredClone(bodies.get(args.document_id)); }
    if (action === 'placeholders') return { placeholders: [] };
    if (action === 'open') {
      const document_id = args.path === source_path ? 'source' : 'copy';
      if (!docs.some(d => d.document_id === document_id)) docs.push({ document_id, path: args.path, modified: false });
      if (document_id === 'copy') bodies.set('copy', structuredClone(bodies.get('source')));
      return { document_id };
    }
    if (action === 'text_apply') {
      if (corrupt) throw Object.assign(Error('partial'), { code: 'PARTIAL_WRITE' });
      let text = bodies.get(args.document_id).text;
      assert.equal(text, args.expected_text);
      for (const e of args.edits) text = text.slice(0, e.start - 1) + e.text + text.slice(e.start - 1 + e.delete_count);
      bodies.set(args.document_id, snap(text));return { text };
    }
    if (action === 'close') { const i = docs.findIndex(d => d.document_id === args.document_id); docs.splice(i, 1); }
    if (action === 'save') assert.equal(args.document_id, 'copy');
    return {};
  } }) };
  const service = new PagesTools(bridge, { roots: [] });
  const fields = [{ name: 'nome', value: 'Viames', bindings: [{ kind: 'text', find: '{{nome}}', expected_count: 2 }] }, { name: 'nota', default: 'Nota standard', bindings: [{ kind: 'text', find: '{{nota}}' }] }, { name: 'facoltativo', required: false, bindings: [{ kind: 'text', find: 'absent' }] }];
  return { folder, source_path, path, fields, docs, calls, bodies, run: args => service.execute('pages_compose', { source_path, path, fields, ...args }), corrupt: () => { corrupt = true; }, duringRead: () => { duringRead = true; } };
}
async function withFixture(fn) { const f = fixture(); try { await fn(f); } finally { rmSync(f.folder, { recursive: true, force: true }); } }

test('composition preview creates no copy; defaults, repeated fields and optional fields apply only to a new opaque copy', () => withFixture(async f => {
  const p = await f.run({}); assert.equal(p.changes, 3);assert.equal(p.fields[2].status, 'skipped');assert.equal(existsSync(f.path), false);
  assert.ok(f.calls.every(c => !['save', 'text_apply', 'fill_placeholders'].includes(c.action)));
  const result = await f.run({ mode: 'apply', expected_revision: p.revision });
  assert.equal(result.source_preserved, true); assert.equal(result.fields[0].status, 'completed');
  assert.equal(f.bodies.get('copy').text, 'Titolo\nViames / Viames\nNota standard');
  assert.ok(f.bodies.get('source').text.includes('{{nome}}'));assert.equal(readFileSync(f.source_path, 'utf8'), 'opaque native bytes');
  assert.equal(readFileSync(f.path, 'utf8'), 'opaque native bytes');
}));

test('required fields, count mismatches and overlapping bindings fail before copying', () => withFixture(async f => {
  for (const fields of [
    [{ ...f.fields[0], value: ' ' }],
    [{ ...f.fields[0], bindings: [{ kind: 'text', find: '{{nome}}', expected_count: 1 }] }],
    [f.fields[0], { ...f.fields[0], name: 'other' }],
    [f.fields[0], { ...f.fields[0] }]
  ]) { await assert.rejects(f.run({ fields }));assert.equal(existsSync(f.path), false); }
}));

test('changed bytes, fields or output path invalidate composition revisions before creating files', () => withFixture(async f => {
  const p = await f.run({});
  await assert.rejects(f.run({ fields: [{ ...f.fields[0], value: 'Changed' }], mode: 'apply', expected_revision: p.revision }), e => e.code === 'REVISION_CHANGED');
  await assert.rejects(f.run({ path: join(f.folder, 'other.pages'), mode: 'apply', expected_revision: p.revision }), e => e.code === 'REVISION_CHANGED');
  writeFileSync(f.source_path, 'changed bytes');
  await assert.rejects(f.run({ mode: 'apply', expected_revision: p.revision }), e => e.code === 'REVISION_CHANGED');
  assert.equal(existsSync(f.path), false);
}));

test('composition refuses unsaved sources and retains externally modified sources opened just for preview', () => withFixture(async f => {
  f.docs[0].modified = true;
  await assert.rejects(f.run({}), e => e.code === 'SOURCE_HAS_UNSAVED_CHANGES');assert.equal(existsSync(f.path), false);
  f.docs.length = 0; f.duringRead();
  await assert.rejects(f.run({}), e => e.code === 'SOURCE_CHANGED');
  assert.equal(f.calls.some(c => c.action === 'close'), false);assert.equal(f.docs[0].modified, true);
}));

test('partial composition reports destination and leaves the copy available without source saves or automatic retries', () => withFixture(async f => {
  const p = await f.run({});f.corrupt();
  await assert.rejects(f.run({ mode: 'apply', expected_revision: p.revision }), e => e.code === 'COMPOSITION_INCOMPLETE' && e.details.document_id === 'copy' && e.details.cause === 'PARTIAL_WRITE');
  assert.equal(existsSync(f.path), true);assert.equal(f.calls.filter(c => c.action === 'text_apply').length, 1);
  assert.equal(f.calls.some(c => c.action === 'save'), false);
}));

test('tagged compositions enforce exact counts, reject duplicate bindings and never mix overlapping literal/tag modes', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'pages-tag-recipe-'));
  try {
    const source_path = join(folder, 'source.pages'), path = join(folder, 'out.pages');writeFileSync(source_path, 'opaque');
    let mutations = 0;
    const service = new PagesTools({ exclusive: f => f({ async call(action, args) {
      if (action === 'documents') return { documents: [{ document_id: 's', path: source_path, modified: false }] };
      if (action === 'placeholders') return { placeholders: [{ index: 1, tag: 'name', text: 'Name' }, { index: 2, tag: 'name', text: 'Name' }] };
      if (action === 'text_snapshot') return snap('Name');
      mutations++;return {};
    } }) }, { roots: [] });
    const field = { name: 'name', value: 'Viames', bindings: [{ kind: 'placeholder', tag: 'name', expected_count: 2 }] };
    const run = fields => service.execute('pages_compose', { source_path, path, fields });
    assert.equal((await run([field])).changes, 2);
    await assert.rejects(run([{ ...field, bindings: [{ kind: 'placeholder', tag: 'name' }] }]), e => e.code === 'MATCH_COUNT');
    await assert.rejects(run([field, { ...field, name: 'other' }]), e => e.code === 'OVERLAPPING_BINDINGS');
    await assert.rejects(run([field, { name: 'literal', value: 'x', bindings: [{ kind: 'text', find: 'Name' }] }]), e => e.code === 'MIXED_BINDINGS');
    assert.equal(mutations, 0);assert.equal(existsSync(path), false);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
