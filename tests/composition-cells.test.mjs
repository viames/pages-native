import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PagesTools } from '../plugins/pages-native/src/tools.mjs';
async function fixture(fn) {
  const folder = mkdtempSync(join(tmpdir(), 'pages-compose-cells-')), source_path = join(folder, 'source.pages'), path = join(folder, 'copy.pages');writeFileSync(source_path, 'opaque');
  const initial = { B2: { value: 0, formula: null, format: 'currency' }, B3: { value: 115, formula: '=SUM(B2:B2)+115', format: 'currency' }, B4: { value: 0, formula: null, format: 'automatic' }, B5: { value: { date: '2026-01-01T12:00:00.000Z' }, formula: null, format: 'date and time' }, B6: { value: 'old', formula: null, format: 'text' } };
  const cells = { source: structuredClone(initial) }, docs = [{ document_id: 'source', path: source_path, modified: false }], calls = [];
  let wrongName = false, concurrentStyle = false, brokenReadback = false;
  const native = async (action, args) => {
    calls.push({ action, args });const address = args?.range;
    if (action === 'documents') return { documents: docs };
    if (action === 'change_snapshot') return { document_id: args.document_id, tables: [{ index: 1, name: wrongName ? 'Other' : 'Spese', rows: 6, columns: 2, locked: false }], content: { cells: [[{ address: args.request.range, ...structuredClone(cells[args.document_id][args.request.range]) }]], styles: { fontSize: [concurrentStyle && args.document_id === 'copy' ? 24 : 12] } } };
    if (action === 'cell_formats') return { formats: [cells[args.document_id][address].format] };
    if (action === 'placeholders') return { placeholders: [] };
    if (action === 'open') { cells.copy = structuredClone(cells.source);docs.push({ document_id: 'copy', path: args.path, modified: false });return { document_id: 'copy' }; }
    if (action === 'save') return {};
    if (action === 'write_cells') {
      const c = cells[args.document_id][address], value = args.values[0][0];
      if (value && typeof value === 'object' && value.formula) { c.formula = value.formula;c.value = 265; }
      else { c.value = value && typeof value === 'object' ? { date: new Date(value.date).toISOString() } : value;c.formula = null;if (typeof value === 'string') c.format = 'text'; }
      if (address === 'B2') cells.copy.B3.value = 265; // dependent formula recalculates before its own binding.
      return { cells: [[{ address, ...structuredClone(c), ...(brokenReadback ? { value: 999 } : {}) }]] };
    }
    throw Error(action);
  };
  const service = new PagesTools({ exclusive: f => f({ call: native }) }, { roots: [] });
  const binding = address => ({ kind: 'cell', table: 1, table_name: 'Spese', address });
  const fields = [{ name: 'importo', value: 150, bindings: [binding('B2')] }, { name: 'totale', value: { formula: '=SUM(B2:B2)+115' }, bindings: [binding('B3')] }, { name: 'flag', default: 0, bindings: [binding('B4')] }, { name: 'data', value: { date: '2026-10-19T12:00:00Z' }, bindings: [binding('B5')] }, { name: 'clear', required: false, value: null, bindings: [binding('B6')] }];
  try { await fn({ run: input => service.execute('pages_compose', { source_path, path, fields, ...input }), path, cells, calls, fields, nameWrong: () => { wrongName = true; }, styleRace: () => { concurrentStyle = true; }, badReadback: () => { brokenReadback = true; } }); }
  finally { rmSync(folder, { recursive: true, force: true }); }
}

test('typed composition preview is read-only and cell apply preserves currency, zero, date and deliberate null', () => fixture(async f => {
  const p = await f.run({});assert.equal(p.changes, 5);assert.equal(p.cells[0].formats[0], 'currency');assert.equal(existsSync(f.path), false);
  assert.ok(!f.calls.some(c => c.action === 'write_cells'));
  const r = await f.run({ mode: 'apply', expected_revision: p.revision });assert.equal(r.cells.length, 5);assert.equal(r.cells[0].value, 150);
  assert.equal(r.cells[2].value, 0);assert.equal(r.cells[3].value.date, '2026-10-19T12:00:00.000Z');assert.equal(r.cells[4].value, null);
  assert.equal(f.cells.source.B2.value, 0);assert.ok(f.calls.filter(c => c.action === 'write_cells').every(c => c.args._expected_state));
}));

test('cell bindings refuse wrong identities, overlapping cells, invalid mixed types and missing required values before copying', () => fixture(async f => {
  for (const fields of [[{ ...f.fields[0], value: null }], [f.fields[0], { ...f.fields[0], name: 'duplicate-cell' }], [{ name: 'text', value: 4, bindings: [{ kind: 'text', find: 'x' }] }]]) {
    await assert.rejects(f.run({ fields }));assert.equal(existsSync(f.path), false);
  }
  f.nameWrong();await assert.rejects(f.run({}), e => e.code === 'TABLE_IDENTITY');assert.equal(existsSync(f.path), false);
}));

test('cell changes invalidate an old composition revision and failed native readback retains a partial copy', () => fixture(async f => {
  const p = await f.run({});f.cells.source.B2.value = 1;
  await assert.rejects(f.run({ mode: 'apply', expected_revision: p.revision }), e => e.code === 'REVISION_CHANGED');assert.equal(existsSync(f.path), false);
  const fresh = await f.run({});f.badReadback();
  await assert.rejects(f.run({ mode: 'apply', expected_revision: fresh.revision }), e => e.code === 'COMPOSITION_INCOMPLETE' && e.details.cause === 'CELL_POSTCHECK_FAILED');
  assert.equal(existsSync(f.path), true);assert.equal(f.calls.filter(c => c.action === 'write_cells').length, 1);
}));


test('Pages boolean fields and checkbox format fail before any cell write or composition copy', () => fixture(async f => {
  await assert.rejects(f.run({ fields: [{ ...f.fields[0], value: false }] }), e => e.code === 'UNSUPPORTED_NATIVE_API');
  assert.equal(existsSync(f.path), false);assert.equal(f.calls.some(c => c.action === 'write_cells'), false);
}));
