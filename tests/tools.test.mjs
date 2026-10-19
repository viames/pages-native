import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PagesTools } from '../plugins/pages-native/src/tools.mjs';
function context(handler) { const calls = []; const service = new PagesTools({ exclusive: fn => fn({ async call(action, args) { calls.push({ action, args }); return handler(action, args); } }) }, { roots: [] }); return { calls, service }; }
const body = text => ({ text, characters: [...text], paragraphs: [text] });
test('text preview has no mutation; matching apply sends reverse guarded native edits', async () => {
  let current = body('Hello Hello');
  const c = context((action, a) => { if (action === 'text_snapshot') return current; assert.equal(action, 'text_apply'); assert.equal(a.expected_text, 'Hello Hello'); assert.deepEqual(a.edits.map(e => e.start), [7, 1]); return body('Hi Hi'); });
  const input = { document_id: 'd', operations: [{ kind: 'replace', find: 'Hello', replacement: 'Hi', occurrence: 'all', expected_count: 2 }] };
  const preview = await c.service.execute('pages_edit_text', input); assert.equal(preview.after, 'Hi Hi'); assert.deepEqual(c.calls.map(x => x.action), ['text_snapshot']);
  const applied = await c.service.execute('pages_edit_text', { ...input, mode: 'apply', expected_revision: preview.revision }); assert.equal(applied.mode, 'applied');
});
test('changed text or operations reject an apply revision before native writes', async () => {
  let current = body('Hello'); const c = context(() => current);
  const input = { document_id: 'd', operations: [{ kind: 'replace', find: 'Hello', replacement: 'Hi' }] };
  const p = await c.service.execute('pages_edit_text', input); current = body('Hello again');
  await assert.rejects(c.service.execute('pages_edit_text', { ...input, mode: 'apply', expected_revision: p.revision }), e => e.code === 'REVISION_CHANGED');
  assert.ok(c.calls.every(x => x.action === 'text_snapshot'));
});
test('postcheck failure reports a completed but unexpected native text result', async () => {
  const c = context(action => action === 'text_snapshot' ? body('Hello') : body('unexpected'));
  const input = { document_id: 'd', operations: [{ kind: 'replace', find: 'Hello', replacement: 'Hi' }] };
  const p = await c.service.execute('pages_edit_text', input);
  await assert.rejects(c.service.execute('pages_edit_text', { ...input, mode: 'apply', expected_revision: p.revision }), e => e.code === 'TEXT_POSTCHECK_FAILED');
  assert.equal(c.calls.at(-1).action, 'text_apply');
});
test('duplicate placeholder tags require explicit native counts and a current revision', async () => {
  let before = { placeholders: [{ index: 1, tag: 'client', text: 'A' }, { index: 2, tag: 'client', text: 'B' }] };
  const c = context(action => { assert.equal(action, 'placeholders'); return before; });
  const input = { document_id: 'd', fields: [{ tag: 'client', text: 'C' }] };
  await assert.rejects(c.service.execute('pages_fill_placeholders', input), e => e.code === 'MATCH_COUNT');
  input.fields[0].expected_count = 2;
  const p = await c.service.execute('pages_fill_placeholders', input); assert.equal(p.replacements.length, 2);
  before = { placeholders: [before.placeholders[0]] };
  await assert.rejects(c.service.execute('pages_fill_placeholders', { ...input, mode: 'apply', expected_revision: p.revision }), e => e.code === 'MATCH_COUNT');
});
test('cell preflight rejects ragged, excessive and unsupported-format writes without writes', async () => {
  const c = context(() => ({ formats: ['other'] }));
  await assert.rejects(c.service.execute('pages_write_cells', { document_id: 'd', table: 1, start: 'A1', values: [[1], [2, 3]] }), e => e.code === 'RAGGED_MATRIX');
  await assert.rejects(c.service.execute('pages_read_cells', { document_id: 'd', table: 1, range: 'A1:C1000' }), e => e.code === 'CELL_LIMIT');
  await assert.rejects(c.service.execute('pages_write_cells', { document_id: 'd', table: 1, start: 'A1', values: [[1]] }), e => e.code === 'UNSUPPORTED_NATIVE_FORMAT');
  assert.deepEqual(c.calls.map(x => x.action), ['cell_formats']);
});
test('formula objects and hostile literal strings remain typed data; formats are verified', async () => {
  const c = context((action, args) => {
    if (action === 'cell_formats') return { formats: ['text', 'currency'] };
    assert.equal(action, 'write_cells'); assert.equal(args.values[0][0], '=1+1'); assert.deepEqual(args.values[0][1], { formula: '=SUM(10;20)' });
    return { cells: [[{ address: 'A1' }, { address: 'B1' }]], format_expectations: ['text', 'currency'], written: 2 };
  });
  const r = await c.service.execute('pages_write_cells', { document_id: 'd', table: 1, start: 'A1', values: [['=1+1', { formula: '=SUM(10;20)' }]] });
  assert.equal(r.formats_verified, true); assert.deepEqual(r.cells[0].map(x => x.format), ['text', 'currency']);
});
test('existing rich text cannot be silently replaced through the object tool', async () => {
  const c = context(() => { throw Error('must not run'); });
  await assert.rejects(c.service.execute('pages_object', { document_id: 'd', kind: 'text', operation: 'update', index: 1, text: 'replacement' }), e => e.code === 'USE_GUARDED_TEXT_EDIT');
  await assert.rejects(c.service.execute('pages_object', { document_id: 'd', kind: 'chart', operation: 'create' }), e => e.code === 'UNSUPPORTED_NATIVE_API');
  assert.equal(c.calls.length, 0);
});
test('unknown fields, missing target indices and ambiguous save/discard fail before native access', async () => {
  const c = context(() => {});
  await assert.rejects(c.service.execute('pages_status', { password: 'not accepted' }));
  await assert.rejects(c.service.execute('pages_read_text', { document_id: 'd', target: { kind: 'section' } }), e => e.code === 'TARGET_INDEX_REQUIRED');
  await assert.rejects(c.service.execute('pages_close', { document_id: 'd' }));
  assert.equal(c.calls.length, 0);
});
