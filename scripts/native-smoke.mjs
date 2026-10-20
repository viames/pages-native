// Real native acceptance only. Requires an explicitly authorized logged-in Mac.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir, release } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { guardedActions } from '../plugins/pages-native/src/changes.mjs';
import { nativeFingerprint } from '../plugins/pages-native/src/native-files.mjs';
const folder = mkdtempSync(join(tmpdir(), 'Pages Native acceptance — '));
const ids = new Set(), checks = [];
const client = new Client({ name: 'pages-native-acceptance', version: '1.0.0' });
const serverPath = resolve(process.argv[2] ?? 'plugins/pages-native/dist/server.mjs');
const runtime = await import(pathToFileURL(join(dirname(serverPath), 'runtime.mjs')).href);
const nativeBridge = new runtime.PagesBridge();
async function raw(name, args = {}) {
  if (process.env.PAGES_NATIVE_VERBOSE === '1') console.log(`START ${name}`);
  const r = await client.callTool({ name: `pages_${name}`, arguments: args }, undefined, { timeout: 180_000 });
  if (r.isError) { const detail = JSON.parse(r.content[0].text).error; const e = new Error(detail.message); e.code = detail.code; e.details = detail.details; throw e; }
  return r.structuredContent;
}
async function call(name, args = {}) {
  if (guardedActions.has(name) && args.mode === undefined && !(name === 'settings' && args.facing_pages === undefined)) {
    const preview = await raw(name, args);
    assert.equal(preview.mode, 'preview');
    return raw(name, { ...args, mode: 'apply', expected_revision: preview.revision });
  }
  return raw(name, args);
}
let environment, status;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function writeCompatibility(statusName) {
  if (!environment) return;
  const server = resolve(process.argv[2] ?? 'plugins/pages-native/dist/server.mjs');
  const native = join(dirname(dirname(server)), 'native');
  const report = { schema_version: 1, report_id: randomUUID(), status: statusName, native_tests_executed: true, plugin_version: status.plugin_version, bundle_sha256: sha256(Buffer.concat([readFileSync(server), readFileSync(join(dirname(server), 'runtime.mjs'))])), native_sha256: sha256(Buffer.concat(['worker.js', 'text.applescript', 'open.applescript'].map(name => readFileSync(join(native, name))))), harness_sha256: sha256(readFileSync(fileURLToPath(import.meta.url))), environment, check_count: checks.length, checks };
  const path = process.env.PAGES_NATIVE_COMPATIBILITY_REPORT || process.argv[4];
  if (path) writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
  return report;
}
function passed(name) { checks.push(name); console.log(`PASS ${name}`); }
async function guarded(document_id, operations, target) {
  const input = { document_id, operations, ...(target ? { target } : {}) };
  const p = await call('edit_text', input);
  try { return await call('edit_text', { ...input, mode: 'apply', expected_revision: p.revision }); }
  catch (e) {
    if (e.code === 'TEXT_POSTCHECK_FAILED') console.error(JSON.stringify({ planned: p.after, observed: (await call('read_text', { document_id, ...(target ? { target } : {}) })).text }));
    throw e;
  }
}
async function acceptance(session) {
let tail = Promise.resolve();
const server = runtime.createServer({ bridge: { exclusive: task => {
  const next = tail.then(() => task(session));
  tail = next.catch(() => {});
  return next;
} } });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
await client.connect(clientTransport);
try {
  status = await call('status', { launch: true });
  environment = { pages_version: status.pages_version, macos_version: status.macos_version, node_version: process.version };
  const compatibility = await call('compatibility', { launch: true }); assert.equal(compatibility.native_acceptance_run_here, false); assert.ok(compatibility.local.dictionary_sha256); passed('native compatibility diagnostics and scripting dictionary fingerprint'); assert.equal(status.automation_tested, true); passed('native status and Automation');
  const templates = (await call('templates')).templates; assert.ok(templates.length > 0); passed('native templates');
  const blank = templates.find(t => /(^|\/)Blank(\/|$)/.test(t.id)); assert.ok(blank, 'Find and verify the actual blank template ID.');
  const path = join(folder, 'Prova Pages Native.pages');
  const d = await call('create', { path, template_id: blank.id, text: 'Pages Native\nMateriali: 120 €\nResiduo: 65 €\nFirma: Viames Marino\nUnicode: 👩🏽‍💻 e\u0301\n' });
  const document_id = d.document_id; ids.add(document_id); assert.equal(d.document_body, true); passed('native create/save');
  const first = await call('read_text', { document_id, include_styles: true }); assert.equal(first.characters.join(''), first.text); assert.ok(first.text.includes('👩🏽‍💻')); passed('native Unicode character mapping');
  await call('format_text', { document_id, first: 1, last: 12, style: { font_name: 'HelveticaNeue-Bold', font_size: 24, color: [8738, 26471, 46003] } });
  const before = await call('read_text', { document_id, include_styles: true }); assert.equal(before.sizes[0], 24); passed('native character style readback');
  const formatting = { document_id, first: 1, last: 12, style: { font_size: 26 } };
  const formattingPreview = await raw('format_text', formatting);
  assert.deepEqual((await call('read_text', { document_id, include_styles: true })).sizes, before.sizes);
  await call('format_text', { ...formatting, style: { font_size: 23 } });
  await assert.rejects(raw('format_text', { ...formatting, mode: 'apply', expected_revision: formattingPreview.revision }), e => e.code === 'REVISION_CHANGED');
  const direct = session;
  await assert.rejects(direct.call('text_format', { ...formatting, target: { kind: 'body' }, _expected_style: formattingPreview.before }), e => e.code === 'REVISION_CHANGED');
  await call('format_text', { ...formatting, style: { font_size: 24 } }); passed('style-only changes block stale formatting in server and native helper');

  const input = { document_id, operations: [{ kind: 'replace', find: '120', replacement: '150', expected_count: 1 }] };
  const preview = await call('edit_text', input); assert.ok(preview.after.includes('150')); assert.equal((await call('read_text', { document_id })).text, before.text); passed('preview has no mutation');
  await guarded(document_id, [{ kind: 'replace', find: 'Firma:', replacement: 'Autore:', expected_count: 1 }]);
  await assert.rejects(call('edit_text', { ...input, mode: 'apply', expected_revision: preview.revision }), e => e.code === 'REVISION_CHANGED'); passed('stale text revision blocked');
  await guarded(document_id, input.operations);
  const after = await call('read_text', { document_id, include_styles: true }); assert.ok(after.text.includes('Materiali: 150')); assert.deepEqual(after.fonts.slice(0, 12), before.fonts.slice(0, 12)); assert.deepEqual(after.sizes.slice(0, 12), before.sizes.slice(0, 12)); passed('native text edits preserve surrounding heading style');
  await guarded(document_id, [{ kind: 'range', start: after.characters.length + 1, delete_count: 0, text: 'Fine' }]); assert.ok((await call('read_text', { document_id })).text.endsWith('Fine')); passed('native append at character boundary');
  await call('table', { document_id, operation: 'create', name: 'Spese', rows: 4, columns: 3, header_rows: 1, header_columns: 0, footer_rows: 0, x: 40, y: 250 });
  const t = (await call('inspect', { document_id })).tables.find(x => x.name === 'Spese'); assert.ok(t); const table = t.index;
  await call('format_cells', { document_id, table, range: 'B2:B4', format: 'currency' });
  await call('write_cells', { document_id, table, start: 'A1', values: [['Voce', 'Importo', 'Nota'], ['Materiali', 150, '=literal'], ['Servizi', 115, null], ['Totale', { formula: '=SUM(B2:B3)' }, null]] });
  const values = await call('read_cells', { document_id, table, range: 'A1:C4' }); assert.equal(values.cells[3][1].value, 265); assert.equal(values.cells[1][2].value, '=literal'); assert.equal(values.cells[1][2].formula, null); assert.equal(values.cells[1][1].format, 'currency'); passed('native table formula, literal strings and currency preservation');
  const writeInput = { document_id, table, start: 'B2', values: [[999]] };
  const tablePreview = await raw('write_cells', writeInput);
  assert.equal((await call('read_cells', { document_id, table, range: 'B2' })).cells[0][0].value, 150);
  await call('format_cells', { document_id, table, range: 'B2', font_size: 13 });
  await assert.rejects(raw('write_cells', { ...writeInput, mode: 'apply', expected_revision: tablePreview.revision }), e => e.code === 'REVISION_CHANGED');
  assert.equal((await call('read_cells', { document_id, table, range: 'B2' })).cells[0][0].value, 150); passed('cell preview has no write and detects style-only changes');
  const valuePreview = await raw('write_cells', writeInput);
  await call('write_cells', { document_id, table, start: 'B2', values: [[151]] });
  await assert.rejects(raw('write_cells', { ...writeInput, mode: 'apply', expected_revision: valuePreview.revision }), e => e.code === 'REVISION_CHANGED');
  await call('write_cells', { document_id, table, start: 'B2', values: [[150]] }); passed('concurrent cell value changes block stale writes');
  const shrinkInput = { document_id, operation: 'update', table, rows: 3 };
  const shrinkPreview = await raw('table', shrinkInput);
  await call('write_cells', { document_id, table, start: 'C4', values: [['Conservare']] });
  await assert.rejects(raw('table', { ...shrinkInput, mode: 'apply', expected_revision: shrinkPreview.revision }), e => e.code === 'REVISION_CHANGED');
  assert.equal((await call('inspect', { document_id })).tables.find(t => t.index === table).rows, 4);
  assert.equal((await call('read_cells', { document_id, table, range: 'C4' })).cells[0][0].value, 'Conservare');
  await call('write_cells', { document_id, table, start: 'C4', values: [[null]] }); passed('stale resize preserves cells that would have been discarded');

  await call('table_dimensions', { document_id, table, axis: 'column', first: 1, last: 1, size: 150 }); passed('native table dimensions');
  await call('object', { document_id, operation: 'create', kind: 'text', page: 1, text: 'Nota di prova', x: 40, y: 470, width: 250, height: 40, font_size: 14 });
  const obj = (await call('objects', { document_id })).objects.find(x => x.kind === 'text' && x.text === 'Nota di prova'); assert.ok(obj); passed('native text object creation/readback');
  const move = { document_id, operation: 'update', kind: 'text', index: obj.index, x: 60 };
  const movePreview = await raw('object', move);
  assert.equal((await call('objects', { document_id })).objects.find(o => o.kind === 'text' && o.index === obj.index).position.x, 40);
  await call('object', { ...move, x: 45 });
  await assert.rejects(raw('object', { ...move, mode: 'apply', expected_revision: movePreview.revision }), e => e.code === 'REVISION_CHANGED');
  await call('object', { ...move, x: 40 }); passed('object preview has no mutation and rejects stale geometry');

  await guarded(document_id, [{ kind: 'replace', find: 'prova', replacement: 'verifica', expected_count: 1 }], { kind: 'text', index: obj.index }); passed('native guarded text item edit');
  await call('settings', { document_id, facing_pages: true }); assert.equal((await call('settings', { document_id })).facing_pages, true); passed('native facing pages');
  const state = await direct.call('change_snapshot', { document_id, action: 'settings', request: { document_id, facing_pages: false } });
  await call('settings', { document_id, facing_pages: false });
  await assert.rejects(direct.call('settings', { document_id, facing_pages: true, _expected_state: state }), e => e.code === 'REVISION_CHANGED');
  await assert.rejects(direct.call('settings', { document_id, facing_pages: true }), e => e.code === 'PREVIEW_REQUIRED');
  passed('native worker rejects stale and missing mutation preconditions');

  await call('save', { document_id });
  const hash = nativeFingerprint(path); const prototype = await call('from_template', { source_path: path, path: join(folder, 'Copia modello.pages') }); ids.add(prototype.document_id); assert.equal(nativeFingerprint(path), hash); passed('custom prototype source preserved');
  await call('close', { document_id: prototype.document_id, save: false }); ids.delete(prototype.document_id);
  const backup = await call('backup', { document_id, path: join(folder, 'Backup.pages'), save_first: true }); assert.equal(backup.verified, true); passed('opaque backup byte verification');
  for (const format of ['pdf', 'txt', 'rtf', 'docx', 'epub']) { const exportPath = join(folder, `export.${format}`); await call('export', { document_id, path: exportPath, format, ...(format === 'epub' ? { options: { title: 'Pages Native test', author: 'Viames Marino', language: 'it' } } : {}) }); assert.equal(existsSync(exportPath), true); passed(`native ${format} export`); }
  const visual = await call('preview', { document_id, path: join(folder, 'Anteprima.pdf') }); assert.ok(visual.page_count > 0); assert.ok(existsSync(visual.image_path)); passed('native PDFKit PNG preview');
  await call('close', { document_id, save: true }); ids.delete(document_id);
  const reopened = await call('open', { path }); ids.add(reopened.document_id); assert.ok((await call('read_text', { document_id: reopened.document_id })).text.includes('Materiali: 150')); passed('native save/close/reopen');
  // Tagged placeholders require a real template exposing at least one placeholder.
  const reportTemplate = templates.find(t => /21_Simple_Report|23_Essay|01_Modern_Report/.test(t.id)); assert.ok(reportTemplate, 'Verify a native report template for placeholder acceptance.');
  const report = await call('create', { path: join(folder, 'Modello report.pages'), template_id: reportTemplate.id }); ids.add(report.document_id);
  const ps = (await call('placeholders', { document_id: report.document_id })).placeholders; assert.ok(ps.length > 0, 'Template exposes no native placeholders; select a verified template before certifying this tool.'); passed('native placeholder discovery');
  const named = ps[0];
  const count = (await call('placeholders', { document_id: report.document_id })).placeholders.filter(p => p.tag === named.tag).length;
  const fields = [{ tag: named.tag, text: 'Prova Pages Native', expected_count: count }];
  const ph = await call('fill_placeholders', { document_id: report.document_id, fields }); assert.equal(ph.replacements.length, count);
  const filled = await call('fill_placeholders', { document_id: report.document_id, fields, mode: 'apply', expected_revision: ph.revision }); assert.equal(filled.completed, count); passed('native guarded placeholder filling');
  const sectionText = await call('read_text', { document_id: reopened.document_id, target: { kind: 'section', index: 1 } }); assert.ok(sectionText.text.includes('Pages Native')); passed('native section text scope');
  const pageText = await call('read_text', { document_id: reopened.document_id, target: { kind: 'page', index: 1 } }); assert.ok(pageText.text.includes('Pages Native')); passed('native page text scope');
  const blankLayout = templates.find(t => /21_Blank_Layout/.test(t.id)); assert.ok(blankLayout);
  const layout = await call('create', { path: join(folder, 'Layout vuoto.pages'), template_id: blankLayout.id }); ids.add(layout.document_id); assert.equal(layout.document_body, false);
  await assert.rejects(call('read_text', { document_id: layout.document_id }), e => e.code === 'NO_DOCUMENT_BODY'); passed('native page-layout mode and body guard');
  await call('object', { document_id: layout.document_id, operation: 'create', kind: 'text', page: 1, text: 'Testo layout', x: 40, y: 70, width: 230, height: 50 });
  const layoutText = (await call('objects', { document_id: layout.document_id })).objects.find(o => o.kind === 'text' && o.text === 'Testo layout'); assert.ok(layoutText);
  await guarded(layout.document_id, [{ kind: 'replace', find: 'layout', replacement: 'pagina', expected_count: 1 }], { kind: 'text', index: layoutText.index }); passed('native page-layout text item edit');
  await call('object', { document_id: layout.document_id, operation: 'create', kind: 'shape', page: 1, text: 'Forma', font_size: 16, locked: true, x: 50, y: 170, width: 120, height: 50 });
  const shape = (await call('objects', { document_id: layout.document_id })).objects.find(o => o.kind === 'shape' && o.text === 'Forma'); assert.ok(shape); assert.equal(shape.locked, true); passed('native shape creation/readback');
  await assert.rejects(raw('object', { document_id: layout.document_id, operation: 'update', kind: 'shape', index: shape.index, x: 70 }), e => e.code === 'OBJECT_LOCKED');
  await call('object', { document_id: layout.document_id, operation: 'update', kind: 'shape', index: shape.index, locked: false, x: 70 });
  assert.equal((await call('objects', { document_id: layout.document_id })).objects.find(o => o.kind === 'shape' && o.index === shape.index).locked, false); passed('locked object preflight and explicit native unlock');
  await call('object', { document_id: layout.document_id, operation: 'create', kind: 'image', page: 1, source_path: visual.image_path, x: 50, y: 260, width: 120, height: 170 });
  const picture = (await call('objects', { document_id: layout.document_id })).objects.find(o => o.kind === 'image'); assert.ok(picture);
  await call('object', { document_id: layout.document_id, operation: 'update', kind: 'image', index: picture.index, x: 70, y: 280 });
  const movedPicture = (await call('objects', { document_id: layout.document_id })).objects.find(o => o.kind === 'image' && o.index === picture.index); assert.equal(movedPicture.position.x, 70); passed('native image creation and geometry update');
  const sorted = await call('create', { path: join(folder, 'Ordina e unisci.pages'), template_id: blank.id }); ids.add(sorted.document_id);
  await call('table', { document_id: sorted.document_id, operation: 'create', name: 'Ordine', rows: 5, columns: 2, header_rows: 1, header_columns: 0, x: 50, y: 200 });
  const sortInfo = (await call('inspect', { document_id: sorted.document_id })).tables.find(t => t.name === 'Ordine'); assert.equal(sortInfo.header_columns, 0);
  const sortTable = sortInfo.index;
  await call('write_cells', { document_id: sorted.document_id, table: sortTable, start: 'A1', values: [['Nome', 'Valore'], ['B', 2], ['A', 1], ['C', 3]] });
  await call('sort_table', { document_id: sorted.document_id, table: sortTable, column: 2, direction: 'ascending' });
  const sortedCells = (await call('read_cells', { document_id: sorted.document_id, table: sortTable, range: 'A2:B4' })).cells;
  assert.deepEqual(sortedCells.map(row => row[0].value), ['A', 'B', 'C']); passed('native table sort');
  await call('merge_cells', { document_id: sorted.document_id, table: sortTable, range: 'A5:B5', operation: 'merge' });
  await call('merge_cells', { document_id: sorted.document_id, table: sortTable, range: 'A5:B5', operation: 'unmerge' }); passed('native table merge/unmerge');
  await call('table', { document_id: sorted.document_id, operation: 'create', name: 'Temporanea', rows: 2, columns: 2, locked: true, x: 50, y: 500 });
  const temporaryTable = (await call('inspect', { document_id: sorted.document_id })).tables.find(t => t.name === 'Temporanea');
  await assert.rejects(raw('table', { document_id: sorted.document_id, operation: 'update', table: temporaryTable.index, rows: 3 }), e => e.code === 'OBJECT_LOCKED');
  await call('table', { document_id: sorted.document_id, operation: 'update', table: temporaryTable.index, rows: 3, locked: false });
  passed('locked table preflight and explicit native unlock');
  assert.equal((await call('inspect', { document_id: sorted.document_id })).tables.find(t => t.name === 'Temporanea').rows, 3);
  await call('table', { document_id: sorted.document_id, operation: 'delete', table: temporaryTable.index });
  assert.equal((await call('inspect', { document_id: sorted.document_id })).tables.some(t => t.name === 'Temporanea'), false); passed('native table resize/delete');
  // Search is read only and native character indices are immediately usable.
  const searchBody = await call('search', { document_id: reopened.document_id, query: 'Materiali', scopes: ['body'] });
  assert.equal(searchBody.total_matches, 1); assert.equal(searchBody.matches[0].target.kind, 'body');
  const bodySnapshot = await call('read_text', { document_id: reopened.document_id });
  const hit = searchBody.matches[0]; assert.equal(bodySnapshot.characters.slice(hit.start - 1, hit.start - 1 + hit.delete_count).join(''), 'Materiali');
  passed('native structured body search returns usable native character references');
  const searchTable = await call('search', { document_id: reopened.document_id, query: 'Materiali', scopes: ['table'] });
  assert.equal(searchTable.matches[0].address, 'A2'); assert.equal(searchTable.matches[0].table, table);
  const searchFormula = await call('search', { document_id: reopened.document_id, query: values.cells[3][1].formula, scopes: ['table'], include_formulas: true });
  assert.equal(searchFormula.matches[0].address, 'B4'); assert.equal(searchFormula.matches[0].channel, 'formula');
  passed('native structured search identifies formatted cells and explicit formulas');
  const textSearch = await call('search', { document_id: reopened.document_id, query: 'VERIFICA', scopes: ['text'], case_sensitive: false });
  assert.equal(textSearch.matches[0].target.index, obj.index);
  const layoutSearch = await call('search', { document_id: layout.document_id, query: 'Forma', scopes: ['body', 'shape'] });
  assert.equal(layoutSearch.matches[0].target.kind, 'shape');
  passed('native search covers text items and layout shapes without requiring a document body');
  const explicitSearch = await call('search', { document_id: reopened.document_id, query: 'Materiali', scopes: ['section'], text_targets: [{ kind: 'section', index: 1 }], max_results: 1 });
  assert.equal(explicitSearch.matches[0].target.kind, 'section');
  const unicodeSearch = await call('search', { document_id: reopened.document_id, query: '👩🏽‍💻', scopes: ['body'] });
  assert.equal(unicodeSearch.total_matches, 1); assert.equal(unicodeSearch.matches[0].matched, '👩🏽‍💻');
  const pageSearch = await call('search', { document_id: reopened.document_id, query: 'Pages Native', scopes: ['page'], text_targets: [{ kind: 'page', index: 1 }] });
  assert.equal(pageSearch.matches[0].target.kind, 'page');
  const pagedSearch = await call('search', { document_id: reopened.document_id, query: 'a', scopes: ['body'], case_sensitive: false, max_results: 1 });
  assert.ok(pagedSearch.total_matches > 1); assert.equal(pagedSearch.next_offset, 1);
  const secondHit = await call('search', { document_id: reopened.document_id, query: 'a', scopes: ['body'], case_sensitive: false, max_results: 1, offset: 1 });
  assert.notEqual(secondHit.matches[0].start, pagedSearch.matches[0].start);
  assert.equal((await call('read_text', { document_id: reopened.document_id })).text, bodySnapshot.text);
  passed('native scoped section page and emoji search with pagination has no text mutation');

  // Release earlier fixtures before the composition phase. Their behavior has
  // already been checked; new template fixtures below own their whole lifecycle.
  for (const oldID of [...ids]) {
    try { await call('close', { document_id: oldID, save: false }); }
    catch (e) { if (e.code !== 'DOCUMENT_NOT_FOUND') throw e; }
    ids.delete(oldID);
  }
  const modelPath = join(folder, 'Modello composizione.pages');
  const model = await call('create', { path: modelPath, template_id: blank.id, text: 'Modello Pages Native\nCliente: {{cliente}}\nConferma: {{cliente}}\nOggetto: {{oggetto}}\n' }); ids.add(model.document_id);
  await call('format_text', { document_id: model.document_id, first: 1, last: 20, style: { font_name: 'HelveticaNeue-Bold', font_size: 22 } });
  await call('object', { document_id: model.document_id, operation: 'create', kind: 'text', page: 1, text: 'Nota: {{nota}}', x: 40, y: 400, width: 280, height: 50 });
  const modelObject = (await call('objects', { document_id: model.document_id })).objects.find(o => o.kind === 'text' && o.text.includes('{{nota}}'));
  const composeInput = { source_path: modelPath, path: join(folder, 'Documento composto.pages'), fields: [
    { name: 'cliente', value: 'Viames Marino', bindings: [{ kind: 'text', find: '{{cliente}}', expected_count: 2 }] },
    { name: 'oggetto', default: 'Prova nativa', bindings: [{ kind: 'text', find: '{{oggetto}}' }] },
    { name: 'nota', value: 'Campi verificati', bindings: [{ kind: 'text', target: { kind: 'text', index: modelObject.index }, find: '{{nota}}' }] },
    { name: 'facoltativo', required: false, bindings: [{ kind: 'text', find: '{{assente}}' }] }
  ] };
  await assert.rejects(call('compose', composeInput), e => e.code === 'SOURCE_HAS_UNSAVED_CHANGES');
  await call('save', { document_id: model.document_id });
  let modelHash = nativeFingerprint(modelPath);
  await assert.rejects(call('compose', { ...composeInput, fields: [{ ...composeInput.fields[0], value: '' }] }), e => e.code === 'REQUIRED_FIELD');
  await assert.rejects(call('compose', { ...composeInput, fields: [{ ...composeInput.fields[0], bindings: [{ kind: 'text', find: '{{cliente}}', expected_count: 1 }] }] }), e => e.code === 'MATCH_COUNT');
  assert.equal(existsSync(composeInput.path), false); passed('native composition rejects unsaved models, missing required fields and wrong counts before copying');
  const composition = await call('compose', composeInput);
  assert.equal(composition.changes, 4); assert.equal(composition.fields[3].status, 'skipped'); assert.equal(existsSync(composeInput.path), false);
  assert.equal(nativeFingerprint(modelPath), modelHash);
  await assert.rejects(call('compose', { ...composeInput, fields: [{ ...composeInput.fields[0], value: 'Changed' }], mode: 'apply', expected_revision: composition.revision }), e => e.code === 'REVISION_CHANGED');
  assert.equal(existsSync(composeInput.path), false); passed('native composition preview preserves source and destination and rejects changed recipes');
  await call('format_text', { document_id: model.document_id, first: 1, last: 20, style: { font_size: 23 } });
  await call('save', { document_id: model.document_id });
  await assert.rejects(call('compose', { ...composeInput, mode: 'apply', expected_revision: composition.revision }), e => e.code === 'REVISION_CHANGED');
  assert.equal(existsSync(composeInput.path), false);
  await call('format_text', { document_id: model.document_id, first: 1, last: 20, style: { font_size: 22 } });
  await call('save', { document_id: model.document_id }); modelHash = nativeFingerprint(modelPath);
  const refreshedComposition = await call('compose', composeInput);
  passed('native saved prototype style changes invalidate composition revisions before copying');
  const composed = await call('compose', { ...composeInput, mode: 'apply', expected_revision: refreshedComposition.revision }); ids.add(composed.document_id);
  assert.equal(composed.saved, true); assert.equal(composed.changes, 4); assert.equal(composed.source_preserved, true);
  const composedText = await call('read_text', { document_id: composed.document_id, include_styles: true });
  assert.ok(composedText.text.includes('Cliente: Viames Marino')); assert.ok(composedText.text.includes('Oggetto: Prova nativa'));
  assert.equal(composedText.sizes[0], 22);
  assert.ok((await call('read_text', { document_id: model.document_id })).text.includes('{{cliente}}'));
  assert.equal(nativeFingerprint(modelPath), modelHash);
  const composedObjects = await call('objects', { document_id: composed.document_id }); assert.ok(composedObjects.objects.some(o => o.text === 'Nota: Campi verificati'));
  passed('native guided composition fills repeated fields and text objects, keeps heading style and preserves prototype bytes');
  const composedVisual = await call('preview', { document_id: composed.document_id, path: join(folder, 'Composizione.pdf') }); assert.ok(existsSync(composedVisual.image_path));
  await call('close', { document_id: composed.document_id, save: true }); ids.delete(composed.document_id);
  const composedAgain = await call('open', { path: composeInput.path }); ids.add(composedAgain.document_id);
  assert.ok((await call('read_text', { document_id: composedAgain.document_id })).text.includes('Viames Marino'));
  passed('native composed output renders and persists through save close reopen');
  const tagPrototypePath = join(folder, 'Modello tag composizione.pages');
  const tagPrototype = await call('create', { path: tagPrototypePath, template_id: reportTemplate.id }); ids.add(tagPrototype.document_id);
  const remainingTags = (await call('placeholders', { document_id: tagPrototype.document_id })).placeholders;
  assert.ok(remainingTags.length);
  const tag = remainingTags[0].tag, tagCount = remainingTags.filter(p => p.tag === tag).length;
  const tagInput = { source_path: tagPrototypePath, path: join(folder, 'Composto con tag.pages'), fields: [{ name: 'titolo', value: 'Composizione da tag nativi', bindings: [{ kind: 'placeholder', tag, expected_count: tagCount }] }] };
  const tagPreview = await call('compose', tagInput);
  const tagResult = await call('compose', { ...tagInput, mode: 'apply', expected_revision: tagPreview.revision }); ids.add(tagResult.document_id);
  assert.equal(tagResult.changes, tagCount); assert.equal(tagResult.fields[0].status, 'completed');
  passed('native guided composition fills exact script-tag placeholders on a saved prototype copy');
  await call('close', { document_id: model.document_id, save: false }); ids.delete(model.document_id);
  const closedPreview = await call('compose', { ...composeInput, path: join(folder, 'Anteprima modello chiuso.pages') });
  assert.equal(closedPreview.changes, 4);
  const remainingDocs = (await call('documents')).documents;
  assert.equal(remainingDocs.some(d => d.path === modelPath), false);
  assert.ok(remainingDocs.some(d => d.document_id === composedAgain.document_id), 'Closing a source must preserve unrelated documents.');
  assert.equal(nativeFingerprint(modelPath), modelHash);
  assert.equal(existsSync(join(folder, 'Anteprima modello chiuso.pages')), false);
  passed('native composition preview opens a closed prototype for reads then closes it without saving or creating output');
  // Typed table fields and portable local recipe library, all on owned fixtures.
  const typedPath = join(folder, 'Modello campi tabella.pages');
  const typed = await call('create', { path: typedPath, template_id: blank.id, text: 'Scheda cliente\nCliente: {{cliente}}\n' }); ids.add(typed.document_id);
  await call('table', { document_id: typed.document_id, operation: 'create', name: 'Dati', rows: 9, columns: 2, header_rows: 1, header_columns: 0, footer_rows: 0, x: 40, y: 180 });
  const typedTable = (await call('inspect', { document_id: typed.document_id })).tables.find(t => t.name === 'Dati').index;
  await call('write_cells', { document_id: typed.document_id, table: typedTable, start: 'A1', values: [['Campo', 'Valore'], ['Materiali', 0], ['Servizi', 115], ['Totale', { formula: '=SUM(B2:B3)' }], ['Data', { date: '2026-01-01T12:00:00Z' }], ['Confermato (0/1)', 0], ['Codice', 'originale'], ['Note', 'da cancellare'], ['Aliquota', 0.22]] });
  await call('format_cells', { document_id: typed.document_id, table: typedTable, range: 'B2:B4', format: 'currency' });
  await call('format_cells', { document_id: typed.document_id, table: typedTable, range: 'B9', format: 'percent' });
  await call('save', { document_id: typed.document_id });
  const typedHash = nativeFingerprint(typedPath);
  const cb = address => ({ kind: 'cell', table: typedTable, table_name: 'Dati', address });
  const definitions = [
    { name: 'cliente', bindings: [{ kind: 'text', find: '{{cliente}}' }] },
    { name: 'materiali', bindings: [cb('B2')] },
    { name: 'servizi', default: 115, bindings: [cb('B3')] },
    { name: 'totale', default: { formula: '=SUM(B2:B3)' }, bindings: [cb('B4')] },
    { name: 'data', bindings: [cb('B5')] },
    { name: 'confermato', default: 0, bindings: [cb('B6')] },
    { name: 'codice', default: 'N/D', bindings: [cb('B7')] },
    { name: 'note', required: false, default: null, bindings: [cb('B8')] },
    { name: 'aliquota', default: 0.22, bindings: [cb('B9')] }
  ];
  const supplied = [{ name: 'cliente', value: 'Cliente di prova' }, { name: 'materiali', value: 150 }, { name: 'data', value: { date: '2026-10-19T12:00:00Z' } }, { name: 'confermato', value: 1 }, { name: 'codice', value: '=testo letterale' }];
  const suppliedMap = new Map(supplied.map(v => [v.name, v.value]));
  const inline = { source_path: typedPath, path: join(folder, 'Campi tabella compilati.pages'), fields: definitions.map(f => ({ ...f, ...(suppliedMap.has(f.name) ? { value: suppliedMap.get(f.name) } : {}) })) };
  const tp = await call('compose', inline);assert.equal(tp.cells.length, 8);assert.equal(tp.changes, 9);assert.equal(existsSync(inline.path), false);assert.equal(nativeFingerprint(typedPath), typedHash);
  passed('native typed table composition preview preserves the prototype and creates no destination');
  await assert.rejects(call('compose', { ...inline, fields: [{ name: 'wrong', value: 1, bindings: [{ ...cb('B2'), table_name: 'Other' }] }] }), e => e.code === 'TABLE_IDENTITY');
  await assert.rejects(call('compose', { ...inline, fields: [inline.fields[1], { ...inline.fields[1], name: 'overlap' }] }), e => e.code === 'OVERLAPPING_BINDINGS');
  await assert.rejects(call('compose', { ...inline, fields: [{ name: 'unsupported', value: false, bindings: [cb('B6')] }] }), e => e.code === 'UNSUPPORTED_NATIVE_API');
  await assert.rejects(raw('write_cells', { document_id: typed.document_id, table: typedTable, start: 'A6', values: [[999, true]] }), e => e.code === 'UNSUPPORTED_NATIVE_API');
  await assert.rejects(raw('format_cells', { document_id: typed.document_id, table: typedTable, range: 'B6', format: 'checkbox' }), e => e.code === 'UNSUPPORTED_NATIVE_API');
  assert.equal((await call('read_cells', { document_id: typed.document_id, table: typedTable, range: 'A6' })).cells[0][0].value, 'Confermato (0/1)');
  assert.equal(existsSync(inline.path), false);passed('native table fields reject wrong names overlapping cells and unsupported boolean controls before mutation');
  const typedOutput = await call('compose', { ...inline, mode: 'apply', expected_revision: tp.revision }); ids.add(typedOutput.document_id);
  const typedCells = (await call('read_cells', { document_id: typedOutput.document_id, table: typedTable, range: 'B2:B9' })).cells.flat();
  assert.equal(typedCells[0].value, 150);assert.equal(typedCells[0].format, 'currency');assert.equal(typedCells[2].value, 265);assert.ok(typedCells[2].formula);
  assert.equal(typedCells[7].format, 'percent');assert.equal(typedCells[7].value, 0.22);assert.equal(nativeFingerprint(typedPath), typedHash);
  passed('native table composition preserves currency and percent and recalculates an explicitly bound formula');
  assert.equal(Date.parse(typedCells[3].value.date), Date.parse('2026-10-19T12:00:00Z'));
  assert.equal(typedCells[4].value, 1);assert.equal(typedCells[4].format, 'automatic');assert.equal(typedCells[5].value, '=testo letterale');assert.equal(typedCells[5].formula, null);assert.equal(typedCells[6].value, null);
  passed('native composed dates numeric flags literal formula-like strings and deliberate clears read back with their types');
  const typedVisual = await call('preview', { document_id: typedOutput.document_id, path: join(folder, 'Campi tabella.pdf') });assert.ok(existsSync(typedVisual.image_path));
  await call('close', { document_id: typedOutput.document_id, save: true });ids.delete(typedOutput.document_id);
  const typedAgain = await call('open', { path: inline.path });ids.add(typedAgain.document_id);
  assert.equal((await call('read_cells', { document_id: typedAgain.document_id, table: typedTable, range: 'B4' })).cells[0][0].value, 265);
  passed('native typed composed output renders and persists after save close reopen');

  const library_path = join(folder, 'Ricette');
  const saveInput = { library_path, name: 'scheda-cliente', operation: 'save', recipe: { source_path: typedPath, description: 'Scheda cliente con tabella nativa', fields: definitions } };
  const rp = await call('recipe', saveInput);assert.equal(existsSync(library_path), false);
  const saved = await call('recipe', { ...saveInput, mode: 'apply', expected_revision: rp.revision });assert.equal(saved.recipe.version, 1);
  assert.equal((await call('recipes', { library_path })).recipes[0].name, 'scheda-cliente');
  const loaded = await call('recipes', { library_path, name: 'scheda-cliente' });assert.equal(loaded.recipe.fields.length, 9);assert.ok(!loaded.recipe.source.path.startsWith('/'));assert.ok(!readFileSync(saved.path, 'utf8').includes('Cliente di prova'));
  passed('native prototype recipes save list and load portable definitions without persisting last-use field values');
  const use = { library_path, name: 'scheda-cliente', path: join(folder, 'Da ricetta.pages'), values: supplied };
  const oldUse = await call('compose_recipe', use);
  const updateInput = { ...saveInput, recipe: { ...saveInput.recipe, description: 'Versione aggiornata' } };
  const updatePreview = await call('recipe', updateInput);
  const updated = await call('recipe', { ...updateInput, mode: 'apply', expected_revision: updatePreview.revision });assert.equal(updated.recipe.version, 2);
  await assert.rejects(call('compose_recipe', { ...use, mode: 'apply', expected_revision: oldUse.revision }), e => e.code === 'REVISION_CHANGED');assert.equal(existsSync(use.path), false);
  passed('native recipe composition rejects an old preview after a library revision changes');
  const usePreview = await call('compose_recipe', use);
  const used = await call('compose_recipe', { ...use, mode: 'apply', expected_revision: usePreview.revision });ids.add(used.document_id);
  assert.equal(used.recipe.version, 2);assert.equal(used.source_preserved, true);assert.equal(used.cells.find(c => c.field === 'totale').value, 265);
  assert.ok((await call('read_text', { document_id: used.document_id })).text.includes('Cliente di prova'));
  passed('native saved recipe composes both body fields and typed cells from explicit supplied values');
  const reuse = { ...use, path: join(folder, 'Ricetta riutilizzata.pages'), values: [{ name: 'cliente', value: 'Secondo cliente' }, { name: 'materiali', value: 0 }, { name: 'data', value: { date: '2026-10-20T12:00:00Z' } }] };
  const reusePreview = await call('compose_recipe', reuse);
  const reused = await call('compose_recipe', { ...reuse, mode: 'apply', expected_revision: reusePreview.revision });ids.add(reused.document_id);
  assert.equal(reused.cells.find(c => c.field === 'materiali').value, 0);assert.equal(reused.cells.find(c => c.field === 'totale').value, 115);assert.equal(reused.cells.find(c => c.field === 'confermato').value, 0);
  assert.equal(nativeFingerprint(typedPath), typedHash);assert.ok(!readFileSync(saved.path, 'utf8').includes('Secondo cliente'));
  passed('native reusable recipes accept numeric zero defaults on a second independent output');
  await call('table', { document_id: tagPrototype.document_id, operation: 'create', name: 'Campi tag', rows: 2, columns: 2, header_rows: 1, header_columns: 0, x: 40, y: 500 });
  const taggedTable = (await call('inspect', { document_id: tagPrototype.document_id })).tables.find(t => t.name === 'Campi tag').index;
  await call('save', { document_id: tagPrototype.document_id });
  const mixed = { source_path: tagPrototypePath, path: join(folder, 'Tag e celle.pages'), fields: [{ name: 'titolo', value: 'Tag e tabella', bindings: [{ kind: 'placeholder', tag, expected_count: tagCount }] }, { name: 'numero', value: 42, bindings: [{ kind: 'cell', table: taggedTable, table_name: 'Campi tag', address: 'B2' }] }] };
  const mixedPreview = await call('compose', mixed);
  const mixedOutput = await call('compose', { ...mixed, mode: 'apply', expected_revision: mixedPreview.revision });ids.add(mixedOutput.document_id);
  assert.equal(mixedOutput.cells[0].value, 42);passed('native recipe fields combine script-tag placeholders with guarded table cells');
  await call('write_cells', { document_id: typed.document_id, table: typedTable, start: 'B2', values: [[1]] });await call('save', { document_id: typed.document_id });
  await assert.rejects(call('compose_recipe', { ...use, path: join(folder, 'Modello cambiato.pages') }), e => e.code === 'RECIPE_SOURCE_CHANGED');assert.equal(existsSync(join(folder, 'Modello cambiato.pages')), false);
  passed('native recipe use rejects a saved prototype whose bytes changed after recipe registration');
  const deletion = { library_path, name: 'scheda-cliente', operation: 'delete' };
  const dp = await call('recipe', deletion);assert.equal((await call('recipes', { library_path })).recipes.length, 1);
  await call('recipe', { ...deletion, mode: 'apply', expected_revision: dp.revision });assert.equal((await call('recipes', { library_path })).recipes.length, 0);
  passed('native recipe library deletion requires its unchanged explicit preview and removes only the named JSON');
  const oldHistory = await call('recipe_history', { library_path, name: 'scheda-cliente' });
  assert.deepEqual(oldHistory.versions.map(v => v.operation), ['save', 'save', 'delete']);assert.ok(oldHistory.versions.every(v => v.prototype_available));
  const oldDiff = await call('recipe_history', { library_path, name: 'scheda-cliente', version: 1, compare_version: 2 });assert.equal(oldDiff.description_changed, true);
  passed('native recipe history retains immutable definitions and saved prototype snapshots across deletion');
  const restoreOld = { library_path, name: 'scheda-cliente', operation: 'restore', version: 1 };
  const rop = await call('recipe', restoreOld);const restoredOld = await call('recipe', { ...restoreOld, mode: 'apply', expected_revision: rop.revision });
  assert.equal(restoredOld.recipe.version, 4);assert.equal(restoredOld.restored_from, 1);assert.equal(nativeFingerprint(join(library_path, restoredOld.recipe.source.path)), typedHash);
  passed('native deleted recipe restoration creates a new current revision pointing at the original opaque model');
  const batchModelPath = join(folder, 'Modello serie.pages');
  const bm = await call('create', { path: batchModelPath, template_id: blank.id, text: 'Prototipo V1\nCliente: {{cliente}}\n' });ids.add(bm.document_id);
  await call('table', { document_id: bm.document_id, operation: 'create', name: 'Serie', rows: 3, columns: 2, header_rows: 1, header_columns: 0, x: 40, y: 200 });
  const bt = (await call('inspect', { document_id: bm.document_id })).tables.find(t => t.name === 'Serie').index;
  await call('write_cells', { document_id: bm.document_id, table: bt, start: 'A1', values: [['Voce', 'Importo'], ['Materiali', 0], ['Totale', { formula: '=B2+115' }]] });
  await call('format_cells', { document_id: bm.document_id, table: bt, range: 'B2:B3', format: 'currency' });await call('save', { document_id: bm.document_id });
  const bmHash = nativeFingerprint(batchModelPath), batchDef = { source_path: batchModelPath, fields: [
    { name: 'cliente', bindings: [{ kind: 'text', find: '{{cliente}}' }] },
    { name: 'materiali', bindings: [{ kind: 'cell', table: bt, table_name: 'Serie', address: 'B2' }] },
    { name: 'totale', default: { formula: '=B2+115' }, bindings: [{ kind: 'cell', table: bt, table_name: 'Serie', address: 'B3' }] }
  ] };
  const saveBatch = async recipe => { const a = { library_path, name: 'lettere-serie', operation: 'save', recipe };const p = await call('recipe', a);return call('recipe', { ...a, mode: 'apply', expected_revision: p.revision }); };
  await saveBatch(batchDef);assert.equal((await call('recipe_history', { library_path, name: 'lettere-serie', version: 1 })).recipe.source.sha256, bmHash);
  passed('native batch recipe archival captures its saved table model before later changes');
  await guarded(bm.document_id, [{ kind: 'replace', find: 'Prototipo V1', replacement: 'Prototipo V2', expected_count: 1 }]);await call('save', { document_id: bm.document_id });
  await saveBatch({ ...batchDef, description: 'Modello versione due' });
  const bd = await call('recipe_history', { library_path, name: 'lettere-serie', version: 1, compare_version: 2 });assert.equal(bd.prototype_changed, true);
  passed('native recipe history compares changed prototypes and keeps the earlier generation intact');
  const batchItems = [
    { id: 'alfa', path: join(folder, 'Lotto Alfa.pages'), values: [{ name: 'cliente', value: 'Cliente Alfa' }, { name: 'materiali', value: 150 }] },
    { id: 'beta', path: join(folder, 'Lotto Beta.pages'), values: [{ name: 'cliente', value: 'Cliente Beta' }, { name: 'materiali', value: 0 }] }
  ];
  const batchInput = { library_path, name: 'lettere-serie', version: 1, items: batchItems };
  await assert.rejects(call('compose_batch', { ...batchInput, items: [batchItems[0], { ...batchItems[1], values: [] }] }), e => e.code === 'BATCH_PREFLIGHT_FAILED');
  await assert.rejects(call('compose_batch', { ...batchInput, items: [batchItems[0], { ...batchItems[1], path: batchItems[0].path }] }), e => e.code === 'DUPLICATE_BATCH_PATH');
  assert.ok(batchItems.every(i => !existsSync(i.path)));
  passed('native batch preflight rejects a later invalid record and duplicate destinations before any output');
  const bp = await call('compose_batch', batchInput);assert.equal(bp.item_count, 2);assert.ok(bp.items.every(i => i.changes === 3));assert.ok(batchItems.every(i => !existsSync(i.path)));
  passed('native two-record batch preview is read only and binds historical recipe values and destinations');
  const currentBatch = { library_path, name: 'lettere-serie', items: [{ ...batchItems[0], id: 'stale', path: join(folder, 'Lotto corrente obsoleto.pages') }] };
  const currentPreview = await call('compose_batch', currentBatch);await saveBatch({ ...batchDef, description: 'Aggiornamento corrente' });
  await assert.rejects(call('compose_batch', { ...currentBatch, mode: 'apply', expected_revision: currentPreview.revision }), e => e.code === 'REVISION_CHANGED');assert.equal(existsSync(currentBatch.items[0].path), false);
  passed('native current-recipe batch revisions reject a library update before creating files');
  const beforeBatchSource = nativeFingerprint(batchModelPath);
  const generated = await call('compose_batch', { ...batchInput, mode: 'apply', expected_revision: bp.revision });assert.equal(generated.completed, 2);assert.equal(generated.failed, 0);assert.ok(generated.results.every(r => r.closed));assert.equal(nativeFingerprint(batchModelPath), beforeBatchSource);
  passed('native historical batch generates two saved independent documents after the current recipe changes');
  let batchVisual;
  for (let i = 0; i < batchItems.length; i++) {
    const d = await call('open', { path: batchItems[i].path });ids.add(d.document_id);
    const text = (await call('read_text', { document_id: d.document_id })).text;assert.ok(text.includes('Prototipo V1'));assert.ok(text.includes(i === 0 ? 'Cliente Alfa' : 'Cliente Beta'));
    const total = (await call('read_cells', { document_id: d.document_id, table: bt, range: 'B3' })).cells[0][0];assert.equal(total.value, i === 0 ? 265 : 115);assert.equal(total.format, 'currency');
    if (i === 0) batchVisual = await call('preview', { document_id: d.document_id, path: join(folder, 'Lotto.pdf') });
    await call('close', { document_id: d.document_id, save: false });ids.delete(d.document_id);
  }
  passed('native batch outputs preserve historical text formulas currency and values through reopen and PDF rendering');
  const restoreBatch = { library_path, name: 'lettere-serie', operation: 'restore', version: 1 };
  const rbp = await call('recipe', restoreBatch);const rb = await call('recipe', { ...restoreBatch, mode: 'apply', expected_revision: rbp.revision });assert.equal(rb.recipe.version, 4);
  const restoredInput = { library_path, name: 'lettere-serie', close_outputs: false, items: [{ id: 'restored', path: join(folder, 'Lotto ripristinato.pages'), values: [{ name: 'cliente', value: 'Cliente ripristinato' }, { name: 'materiali', value: 20 }] }] };
  const restoredPreview = await call('compose_batch', restoredInput);const restoredBatch = await call('compose_batch', { ...restoredInput, mode: 'apply', expected_revision: restoredPreview.revision });assert.equal(restoredBatch.completed, 1);const restoredID = restoredBatch.results[0].document_id;ids.add(restoredID);
  assert.ok((await call('read_text', { document_id: restoredID })).text.includes('Prototipo V1'));assert.equal((await call('read_cells', { document_id: restoredID, table: bt, range: 'B3' })).cells[0][0].value, 135);
  passed('native restored current recipes replay the archived model in a new batch without overwriting the changed original');
  assert.equal(checks.length, 76);
  const evidence = { passed: true, tool_count: 36, check_count: checks.length, pages_version: status.pages_version, darwin_release: release(), node: process.version, host_count: 1, checks, fixture_directory: folder, preview_image: visual.image_path, composition_preview_image: composedVisual.image_path, typed_preview_image: typedVisual.image_path, batch_preview_image: batchVisual.image_path, pending_additional_native_coverage: ['multiple Macs/Pages versions', 'existing chart geometry on a user-supplied document'] };
  const evidencePath = process.env.PAGES_NATIVE_EVIDENCE || process.argv[3];
  if (evidencePath) writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  writeCompatibility('passed');
  console.log(JSON.stringify({ ...evidence, fixture_directory: 'isolated temporary directory (private evidence file)', preview_image: 'saved locally (private evidence file)', composition_preview_image: 'saved locally (private evidence file)', typed_preview_image: 'saved locally (private evidence file)', batch_preview_image: 'saved locally (private evidence file)' }, null, 2));
} catch (error) {
  if (error.code === 'COMPOSITION_INCOMPLETE' && error.details?.path?.startsWith(folder + '/') && error.details?.document_id) ids.add(error.details.document_id);
  writeCompatibility('failed');
  const evidencePath = process.env.PAGES_NATIVE_EVIDENCE || process.argv[3];
  if (evidencePath) writeFileSync(evidencePath, JSON.stringify({ passed: false, check_count: checks.length, checks, fixture_directory: folder, fixture_document_ids: [...ids], error_code: error.code ?? 'ACCEPTANCE_FAILED' }, null, 2));
  throw error;
} finally {
  await tail;
  for (const document_id of ids) { try { await call('close', { document_id, save: false }); } catch (e) { if (e.code === 'DOCUMENT_NOT_FOUND') continue; console.error(`Fixture cleanup stopped: ${e.code ?? e.message}`); break; } }
  await client.close();
  await server.close();
}
}
const waitSeconds = Number(process.env.PAGES_NATIVE_WAIT_SECONDS ?? 0);
if (!Number.isInteger(waitSeconds) || waitSeconds < 0 || waitSeconds > 600) throw new Error('PAGES_NATIVE_WAIT_SECONDS must be 0–600.');
const deadline = Date.now() + waitSeconds * 1000;
for (;;) {
  let started = false;
  try { await nativeBridge.exclusive(session => { started = true; return acceptance(session); }); break; }
  catch (error) {
    if (started || error.code !== 'PAGES_BUSY' || Date.now() >= deadline) throw error;
    await setTimeout(1000); // Only retry lock acquisition; never a native mutation.
  }
}
