import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PagesTools } from '../plugins/pages-native/src/tools.mjs';
import { compatibilityReport } from '../plugins/pages-native/src/compatibility.mjs';

function api(state, handler = action => action === 'cell_formats' ? { formats: [] } : {}) {
  const calls = [];
  const service = new PagesTools({ exclusive: fn => fn({ async call(action, args) {
    calls.push({ action, args });
    if (action === 'change_snapshot' || action === 'text_snapshot') return structuredClone(state.current);
    return handler(action, args);
  } }) }, { roots: [] });
  return { calls, run: (name, args) => service.execute(`pages_${name}`, args) };
}
const mutations = [
  ['table', { operation: 'update', table: 1, rows: 4 }],
  ['format_cells', { table: 1, range: 'A1', font_size: 12 }],
  ['sort_table', { table: 1, column: 1, direction: 'ascending' }],
  ['merge_cells', { table: 1, range: 'A1:B1', operation: 'merge' }],
  ['table_dimensions', { table: 1, axis: 'row', first: 1, last: 2, size: 30 }],
  ['object', { operation: 'delete', kind: 'image', index: 1 }],
  ['settings', { facing_pages: true }]
];
test('all guarded tools default to read-only previews and pass native preconditions only on matching apply', async () => {
  for (const [name, values] of mutations) {
    const state = { current: { content: 'Before', geometry: { x: 10 } } };
    const a = api(state), input = { document_id: 'd', ...values };
    const p = await a.run(name, input);
    assert.equal(p.mode, 'preview'); assert.deepEqual(a.calls.map(c => c.action), ['change_snapshot']);
    const r = await a.run(name, { ...input, mode: 'apply', expected_revision: p.revision });
    assert.equal(r.mode, 'applied'); assert.equal(r.guard_verified, true);
    const mutation = a.calls.find(c => c.action === name);
    assert.deepEqual(mutation.args._expected_state, state.current);
  }
});
test('content, style and geometry changes or changed requests invalidate previews without native mutations', async () => {
  for (const field of ['content', 'font', 'x']) {
    const state = { current: { content: 'Before', font: 'Helvetica', x: 10 } };
    const a = api(state), input = { document_id: 'd', operation: 'update', kind: 'text', index: 1, x: 20 };
    const p = await a.run('object', input); state.current[field] = 'Changed';
    await assert.rejects(a.run('object', { ...input, mode: 'apply', expected_revision: p.revision }), e => e.code === 'REVISION_CHANGED');
    assert.ok(a.calls.every(c => c.action === 'change_snapshot'));
  }
  const a = api({ current: {} }), input = { document_id: 'd', operation: 'update', kind: 'text', index: 1, x: 20 };
  const p = await a.run('object', input);
  await assert.rejects(a.run('object', { ...input, x: 30, mode: 'apply', expected_revision: p.revision }), e => e.code === 'REVISION_CHANGED');
  await assert.rejects(a.run('object', { ...input, mode: 'apply' }), e => e.code === 'REVISION_CHANGED');
});
test('formatting previews cover native text AND styles, including concurrent style-only changes', async () => {
  const state = { current: { text: 'AB', characters: ['A', 'B'], fonts: ['Helvetica', 'Helvetica'], sizes: [11, 11], colors: [[0, 0, 0], [0, 0, 0]] } };
  const a = api(state), input = { document_id: 'd', first: 1, last: 2, style: { font_size: 14 } };
  const p = await a.run('format_text', input); state.current.sizes[1] = 12;
  await assert.rejects(a.run('format_text', { ...input, mode: 'apply', expected_revision: p.revision }), e => e.code === 'REVISION_CHANGED');
  assert.ok(a.calls.every(c => c.action === 'text_snapshot'));
  const fresh = await a.run('format_text', input);
  await a.run('format_text', { ...input, mode: 'apply', expected_revision: fresh.revision });
  assert.deepEqual(a.calls.at(-1).args._expected_style, state.current);
  assert.equal(a.calls.at(-1).action, 'text_format');
  await assert.rejects(a.run('format_text', { ...input, last: 3 }), e => e.code === 'TEXT_RANGE');
});
test('replacing source image bytes invalidates a creation preview even when the path is unchanged', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'pages-source-guard-'));
  try {
    const source_path = join(folder, 'image.png'); writeFileSync(source_path, 'first image');
    const a = api({ current: { objects: [] } }), input = { document_id: 'd', operation: 'create', kind: 'image', source_path };
    const p = await a.run('object', input); writeFileSync(source_path, 'changed image');
    await assert.rejects(a.run('object', { ...input, mode: 'apply', expected_revision: p.revision }), e => e.code === 'REVISION_CHANGED');
    assert.ok(a.calls.every(c => c.action === 'change_snapshot'));
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
test('compatibility diagnostics never certify a Mac and never carry fixture paths or document content', () => {
  const evidence = { status: 'passed', plugin_version: '0.2.0', pages_version: '14.5', macos_version: '27.0.1', node_version: process.version, fixture_directory: '/private/fixtures', document_text: 'private' };
  const local = { automation_tested: true, pages_version: '14.5', macos_version: '27.0.1' };
  const r = compatibilityReport(local, { evidence, version: '0.2.0' });
  assert.equal(r.environment_matches_record, true); assert.equal(r.native_acceptance_run_here, false);
  assert.ok(!JSON.stringify(r).includes('private'));
  assert.equal(compatibilityReport(local, { evidence, version: '0.3.0' }).environment_matches_record, false);
  assert.equal(compatibilityReport({ ...local, pages_version: '15.4' }, { evidence, version: '0.2.0' }).environment_matches_record, false);
  assert.equal(compatibilityReport({ ...local, automation_tested: false }, { evidence, version: '0.2.0' }).environment_matches_record, false);
  assert.equal(compatibilityReport(local, { evidence: { ...evidence, node_version: 'v22.0.0' }, version: '0.2.0' }).environment_matches_record, false);
});
