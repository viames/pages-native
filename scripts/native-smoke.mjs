// Real native acceptance only. Requires an explicitly authorized logged-in Mac.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir, release } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { nativeFingerprint } from '../plugins/pages-native/src/native-files.mjs';
const folder = mkdtempSync(join(tmpdir(), 'Pages Native acceptance — '));
const ids = new Set(), checks = [];
const client = new Client({ name: 'pages-native-acceptance', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [resolve(process.argv[2] ?? 'plugins/pages-native/dist/server.mjs')] });
async function call(name, args = {}) {
  const r = await client.callTool({ name: `pages_${name}`, arguments: args });
  if (r.isError) { const detail = JSON.parse(r.content[0].text).error; const e = new Error(detail.message); e.code = detail.code; e.details = detail.details; throw e; }
  return r.structuredContent;
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
await client.connect(transport);
try {
  const status = await call('status', { launch: true }); assert.equal(status.automation_tested, true); passed('native status and Automation');
  const templates = (await call('templates')).templates; assert.ok(templates.length > 0); passed('native templates');
  const blank = templates.find(t => /(^|\/)Blank(\/|$)/.test(t.id)); assert.ok(blank, 'Find and verify the actual blank template ID.');
  const path = join(folder, 'Prova Pages Native.pages');
  const d = await call('create', { path, template_id: blank.id, text: 'Pages Native\nMateriali: 120 €\nResiduo: 65 €\nFirma: Viames Marino\nUnicode: 👩🏽‍💻 e\u0301\n' });
  const document_id = d.document_id; ids.add(document_id); assert.equal(d.document_body, true); passed('native create/save');
  const first = await call('read_text', { document_id, include_styles: true }); assert.equal(first.characters.join(''), first.text); assert.ok(first.text.includes('👩🏽‍💻')); passed('native Unicode character mapping');
  await call('format_text', { document_id, first: 1, last: 12, style: { font_name: 'HelveticaNeue-Bold', font_size: 24, color: [8738, 26471, 46003] } });
  const before = await call('read_text', { document_id, include_styles: true }); assert.equal(before.sizes[0], 24); passed('native character style readback');
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
  await call('table_dimensions', { document_id, table, axis: 'column', first: 1, last: 1, size: 150 }); passed('native table dimensions');
  await call('object', { document_id, operation: 'create', kind: 'text', page: 1, text: 'Nota di prova', x: 40, y: 470, width: 250, height: 40, font_size: 14 });
  const obj = (await call('objects', { document_id })).objects.find(x => x.kind === 'text' && x.text === 'Nota di prova'); assert.ok(obj); passed('native text object creation/readback');
  await guarded(document_id, [{ kind: 'replace', find: 'prova', replacement: 'verifica', expected_count: 1 }], { kind: 'text', index: obj.index }); passed('native guarded text item edit');
  await call('settings', { document_id, facing_pages: true }); assert.equal((await call('settings', { document_id })).facing_pages, true); passed('native facing pages');
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
  await call('object', { document_id: layout.document_id, operation: 'create', kind: 'shape', page: 1, text: 'Forma', x: 50, y: 170, width: 120, height: 50 });
  const shape = (await call('objects', { document_id: layout.document_id })).objects.find(o => o.kind === 'shape' && o.text === 'Forma'); assert.ok(shape); passed('native shape creation/readback');
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
  await call('table', { document_id: sorted.document_id, operation: 'create', name: 'Temporanea', rows: 2, columns: 2, x: 50, y: 500 });
  const temporaryTable = (await call('inspect', { document_id: sorted.document_id })).tables.find(t => t.name === 'Temporanea');
  await call('table', { document_id: sorted.document_id, operation: 'update', table: temporaryTable.index, rows: 3 });
  assert.equal((await call('inspect', { document_id: sorted.document_id })).tables.find(t => t.name === 'Temporanea').rows, 3);
  await call('table', { document_id: sorted.document_id, operation: 'delete', table: temporaryTable.index });
  assert.equal((await call('inspect', { document_id: sorted.document_id })).tables.some(t => t.name === 'Temporanea'), false); passed('native table resize/delete');
  assert.equal(checks.length, 34);
  const evidence = { passed: true, tool_count: 28, check_count: checks.length, pages_version: status.pages_version, darwin_release: release(), node: process.version, host_count: 1, checks, fixture_directory: folder, preview_image: visual.image_path, pending_additional_native_coverage: ['multiple Macs/Pages versions', 'existing chart geometry on a user-supplied document'] };
  const evidencePath = process.env.PAGES_NATIVE_EVIDENCE || process.argv[3];
  if (evidencePath) writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  for (const document_id of ids) { try { await call('close', { document_id, save: false }); } catch (e) { console.error(`Fixture cleanup stopped: ${e.code ?? e.message}`); break; } }
  await client.close();
}
