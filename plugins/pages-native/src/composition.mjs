import { NativeError } from './bridge.mjs';
import { nativeFingerprint, copyNativePrototype } from './native-files.mjs';
import { revision, planTextEdits } from './text-edits.mjs';
import { cellValue } from './recipe-schemas.mjs';
import { parseRange } from './paths.mjs';
const fail = (code, message, details) => { throw new NativeError(code, message, details); };

export async function compositionPlan(session, document_id, fields) {
  const names = new Set(), modes = new Set(), groups = new Map(), replacements = [], summary = [], cells = [], cellKeys = new Set();
  let beforePlaceholders, characterBudget = 0;
  for (const f of fields) {
    if (names.has(f.name)) fail('DUPLICATE_FIELD', 'Field names must be unique.', { name: f.name });
    names.add(f.name);
    const value = f.value !== undefined ? f.value : f.default;
    if (value === undefined || (f.required && (value === null || (typeof value === 'string' && !value.trim())))) {
      if (f.required) fail('REQUIRED_FIELD', 'Supply a non-empty value for the required field.', { name: f.name });
      summary.push({ name: f.name, status: 'skipped', occurrences: 0 }); continue;
    }
    let occurrences = 0;
    for (const b of f.bindings) {
      if (b.kind === 'cell') {
        if (cells.length >= 200) fail('COMPOSITION_LIMIT', 'Compose at most 200 native cell bindings.');
        if (typeof value === 'boolean') fail('UNSUPPORTED_NATIVE_API', 'Pages coerces boolean cell values to numbers and does not support checkbox controls. Supply an explicit number or literal text.');
        cellValue.parse(value);const bounds = parseRange(b.address);
        if (bounds.count !== 1 || b.address.includes(':')) fail('INVALID_RANGE', 'A field binds one explicit native cell.');
        const key = `${b.table}:${b.address}`;
        if (cellKeys.has(key)) fail('OVERLAPPING_BINDINGS', 'A native cell can belong to only one binding.');cellKeys.add(key);
        const request = { table: b.table, range: b.address, values: [[value]], preserve_format: b.preserve_format };
        const before = await session.call('change_snapshot', { document_id, action: 'write_cells', request: { document_id, ...request } });
        const table = before.tables.find(t => t.index === b.table);
        if (!table || table.name !== b.table_name) fail('TABLE_IDENTITY', 'The native table index/name differs from the binding.', { field: f.name, table: b.table });
        const formats = (await session.call('cell_formats', { document_id, table: b.table, range: b.address })).formats;
        if (formats.length !== 1 || (b.preserve_format && formats[0] === 'other')) fail('UNSUPPORTED_NATIVE_FORMAT', 'Read the native format or choose deliberate preserve_format=false.');
        const { document_id: ignored, ...state } = before;
        cells.push({ field: f.name, table_name: b.table_name, request, before: state, formats });occurrences++;
        continue;
      }
      if (typeof value !== 'string') fail('FIELD_TYPE', 'Text and placeholder bindings require literal string values.', { field: f.name });
      modes.add(b.kind);
      if (modes.size > 1) fail('MIXED_BINDINGS', 'Use either native placeholder tags or literal text bindings in one recipe, to avoid overlapping edits.');
      if (b.kind === 'text') {
        const key = JSON.stringify(b.target);
        if (!groups.has(key)) {
          if (groups.size >= 100) fail('COMPOSITION_LIMIT', 'Compose at most 100 native text targets.');
          const snapshot = await session.call('text_snapshot', { document_id, target: b.target, include_styles: false });
          characterBudget += snapshot.characters.length;
          if (characterBudget > 100000) fail('COMPOSITION_LIMIT', 'Composition supports at most 100,000 native text characters.');
          groups.set(key, { target: b.target, snapshot, operations: [] });
        }
        groups.get(key).operations.push({ kind: 'replace', find: b.find, replacement: value, occurrence: 'all', expected_count: b.expected_count });
        occurrences += b.expected_count;
      } else {
        beforePlaceholders ??= await session.call('placeholders', { document_id });
        const found = beforePlaceholders.placeholders.filter(p => p.tag === b.tag);
        if (found.length !== b.expected_count) fail('MATCH_COUNT', 'Native placeholder count differs from the recipe.', { field: f.name, tag: b.tag, expected: b.expected_count, actual: found.length });
        for (const p of found) {
          if (replacements.some(r => r.index === p.index)) fail('OVERLAPPING_BINDINGS', 'Each native placeholder can belong to only one field.');
          replacements.push({ index: p.index, tag: p.tag, before: p.text, text: value });
        }
        occurrences += found.length;
      }
    }
    summary.push({ name: f.name, status: 'planned', occurrences, value });
  }
  const targets = [...groups.values()];
  // Body/section/page text can overlap despite different native references.
  if (targets.filter(g => ['body', 'section', 'page'].includes(g.target.kind)).length > 1) fail('OVERLAPPING_SCOPES', 'Use only one body/section/page target in a composition recipe.');
  if (targets.reduce((n, g) => n + g.snapshot.characters.length, 0) > 100000) fail('COMPOSITION_LIMIT', 'Composition supports at most 100,000 native text characters.');
  for (const g of targets) g.plan = planTextEdits(g.snapshot, g.operations);
  const changes = targets.reduce((n, g) => n + g.plan.changes, replacements.length + cells.length);
  if (changes > 200) fail('COMPOSITION_LIMIT', 'Compose at most 200 native replacements per document.');
  if (!changes) fail('NO_COMPOSITION_CHANGES', 'No field has a value to apply.');
  return { targets, ...(cells.length ? { cells } : {}), ...(beforePlaceholders ? { beforePlaceholders } : {}), replacements: replacements.sort((a, b) => b.index - a.index), fields: summary, changes };
}

export async function composeDocument(session, args, canonical, native = (name, input) => session.call(name, input), beforeCopy = () => {}) {
  const { mode, expected_revision, ...request } = args;
  const matchesSource = d => { if (!d.path) return false;try { return canonical(d.path) === args.source_path; } catch { return false; } };
  const docs = (await session.call('documents')).documents;
  const source = docs.find(matchesSource);
  if (source?.modified) fail('SOURCE_HAS_UNSAVED_CHANGES', 'Save the prototype deliberately before composing.');
  const sourceHash = nativeFingerprint(args.source_path);
  let sourceID = source?.document_id, openedHere = false, plan;
  try {
    if (!sourceID) { sourceID = (await session.call('open', { path: args.source_path })).document_id; openedHere = true; }
    plan = await compositionPlan(session, sourceID, args.fields);
    const now = (await session.call('documents')).documents.find(d => d.document_id === sourceID);
    if (!now || now.modified || nativeFingerprint(args.source_path) !== sourceHash) fail('SOURCE_CHANGED', 'The prototype changed during preview; save it and preview again.');
  } finally {
    if (openedHere && sourceID) {
      const current = (await session.call('documents')).documents.find(d => d.document_id === sourceID);
      if (current && !current.modified) await session.call('close', { document_id: sourceID, save: false });
      // Leave a newly modified source open: never discard another actor's edits.
    }
  }
  const rev = revision({ request, source_sha256: sourceHash, plan });
  const notices = ['The saved prototype is copied opaquely; its original is never edited or saved.', 'Only explicitly mapped fields are filled. Other placeholder text can remain.', 'Native writes are not transactional. A failed copy remains available for inspection; do not automatically retry.'];
  if (mode === 'preview') return { mode, revision: rev, source_sha256: sourceHash, fields: plan.fields, changes: plan.changes, targets: plan.targets.map(g => ({ target: g.target, before: g.snapshot.text, after: g.plan.after })), placeholders: plan.replacements, cells: plan.cells ?? [], notices };
  if (expected_revision !== rev) fail('REVISION_CHANGED', 'The prototype, field values, bindings or output path changed. Preview the identical request again.');
  const latest = (await session.call('documents')).documents.find(matchesSource);
  if (latest?.modified || nativeFingerprint(args.source_path) !== sourceHash) fail('SOURCE_CHANGED', 'The prototype changed before copying.');
  beforeCopy();
  copyNativePrototype(args.source_path, args.path);
  if (nativeFingerprint(args.source_path) !== sourceHash || nativeFingerprint(args.path) !== sourceHash) fail('COPY_VERIFICATION_FAILED', 'Prototype copy verification failed. Inspect the destination.', { path: args.path });
  let document_id; const completed = [];
  try {
    document_id = (await session.call('open', { path: args.path })).document_id;
    const copiedPlan = await compositionPlan(session, document_id, args.fields);
    if (revision(copiedPlan) !== revision(plan)) fail('COPY_STATE_CHANGED', 'The opened copy differs from the preview; no fields were applied.');
    for (const g of copiedPlan.targets) {
      const result = await session.call('text_apply', { document_id, target: g.target, expected_text: g.snapshot.text, edits: g.plan.edits });
      if (result.text !== g.plan.after) fail('TEXT_POSTCHECK_FAILED', 'Native text differs from the composed result.');
      completed.push({ target: g.target, replacements: g.plan.changes });
    }
    if (copiedPlan.replacements.length) {
      const result = await session.call('fill_placeholders', { document_id, replacements: copiedPlan.replacements, _expected_placeholders: copiedPlan.beforePlaceholders });
      if (result.completed !== copiedPlan.replacements.length) fail('PLACEHOLDER_POSTCHECK_FAILED', 'Native placeholder completion differs from the plan.');
      completed.push({ kind: 'placeholder', replacements: result.completed });
    }
    const cellReadbacks = [];
    for (const cell of copiedPlan.cells ?? []) {
      const request = { document_id, ...cell.request };
      const state = await session.call('change_snapshot', { document_id, action: 'write_cells', request });
      // Our earlier field writes can recalculate formulas or reflow geometry.
      // Still reject manual changes to target identity, input, formula or styles.
      const oldTable = cell.before.tables.find(t => t.index === cell.request.table), table = state.tables.find(t => t.index === cell.request.table);
      const comparable = content => {
        const copy = structuredClone(content);
        for (const c of copy.cells.flat()) if (c.formula) { delete c.value; delete c.formatted; }
        return copy;
      };
      if (!table || ['name', 'rows', 'columns', 'header_rows', 'header_columns', 'footer_rows', 'locked'].some(k => table[k] !== oldTable[k]) || revision(comparable(state.content)) !== revision(comparable(cell.before.content))) fail('REVISION_CHANGED', 'A bound native cell, table identity or cell style changed during composition.');
      const formats = (await session.call('cell_formats', request)).formats;
      if (revision(formats) !== revision(cell.formats)) fail('REVISION_CHANGED', 'A bound cell format changed during composition.');
      const written = await native('write_cells', { ...request, _expected_state: state });
      const actual = written.cells?.[0]?.[0], value = cell.request.values[0][0];
      const valid = value && typeof value === 'object'
        ? (value.formula ? typeof actual?.formula === 'string' && actual.formula.startsWith('=') : Date.parse(actual?.value?.date) === Date.parse(value.date))
        : actual && actual.value === value && !actual.formula;
      if (!valid) fail('CELL_POSTCHECK_FAILED', 'A native cell differs from the composed value. Inspect the destination.');
      completed.push({ kind: 'cell', field: cell.field, table: cell.request.table, address: cell.request.range });
      cellReadbacks.push({ field: cell.field, table: cell.request.table, ...actual });
    }
    await session.call('save', { document_id });
    if (nativeFingerprint(args.source_path) !== sourceHash) fail('SOURCE_CHANGED', 'The source bytes changed externally during composition.');
    const remaining = (await session.call('placeholders', { document_id })).placeholders;
    return { mode: 'applied', document_id, path: args.path, source_path: args.source_path, source_sha256: sourceHash, source_preserved: true, saved: true, changes: copiedPlan.changes, fields: copiedPlan.fields.map(f => ({ ...f, status: f.status === 'planned' ? 'completed' : f.status })), remaining_placeholders: remaining, cells: cellReadbacks, completed, notices };
  } catch (error) {
    throw new NativeError('COMPOSITION_INCOMPLETE', 'Composition stopped. Inspect the destination before retrying; some fields may already be applied.', { cause: error.code ?? 'NATIVE_ERROR', path: args.path, ...(document_id ? { document_id } : {}), completed });
  }
}
