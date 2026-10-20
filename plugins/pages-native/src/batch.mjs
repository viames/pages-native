import { NativeError } from './bridge.mjs';
import { revision } from './text-edits.mjs';
import { composeDocument } from './composition.mjs';
import { resolveRecipe, verifyRecipeRecord } from './recipes.mjs';
const fail = (code, message, details) => { throw new NativeError(code, message, details); };
const uncertain = e => ['NATIVE_TIMEOUT', 'STATE_UNCERTAIN', 'APPLE_EVENT_TIMEOUT', 'OPEN_PENDING', 'NATIVE_PROCESS_FAILED', 'NATIVE_OUTPUT_LIMIT', 'INVALID_NATIVE_RESPONSE'].includes(e.code) || ['NATIVE_TIMEOUT', 'STATE_UNCERTAIN', 'APPLE_EVENT_TIMEOUT', 'OPEN_PENDING', 'NATIVE_PROCESS_FAILED', 'NATIVE_OUTPUT_LIMIT', 'INVALID_NATIVE_RESPONSE'].includes(e.details?.cause);
export async function composeBatch(session, args, pathGuard, native) {
  const { mode, expected_revision, ...request } = args, ids = new Set(), paths = new Set(), plans = [];
  for (const item of args.items) {
    if (ids.has(item.id)) fail('DUPLICATE_BATCH_ID', 'Every batch item needs a unique ID.');ids.add(item.id);
    const path = pathGuard(item.path, { extensions: ['.pages'], mustBeNew: true });
    const key = path.normalize('NFC').toLowerCase();
    if (paths.has(key)) fail('DUPLICATE_BATCH_PATH', 'Batch output paths must differ, conservatively ignoring case and Unicode normalization.');paths.add(key);
    plans.push({ item, path });
  }
  for (const p of plans) {
    try {
      const resolved = resolveRecipe({ ...args, values: p.item.values }, pathGuard);
      const recipe = { library_path: args.library_path, name: args.name, version: resolved.record.recipe.version, revision: resolved.record.revision, ...(args.version !== undefined ? { history_version: args.version } : {}) };
      const input = { source_path: resolved.source_path, path: p.path, fields: resolved.fields, _recipe: recipe };
      const preview = await composeDocument(session, { ...input, mode: 'preview' }, v => pathGuard(v, { mustExist: true }), native, () => verifyRecipeRecord(recipe));
      Object.assign(p, { input, recipe, preview });
    } catch (e) { throw new NativeError('BATCH_PREFLIGHT_FAILED', 'No batch output was created. Correct the first invalid item and preview again.', { item_id: p.item.id, cause: e.code ?? 'INVALID_ARGUMENT', ...(e.details ? { cause_details: e.details } : {}) }); }
  }
  const rev = revision({ request, plans: plans.map(p => ({ id: p.item.id, path: p.path, revision: p.preview.revision, recipe: p.recipe })) });
  if (mode === 'preview') return { mode, revision: rev, item_count: plans.length, items: plans.map(p => ({ id: p.item.id, path: p.path, changes: p.preview.changes, fields: p.preview.fields, recipe: p.recipe })), on_error: args.on_error, close_outputs: args.close_outputs, notices: ['Every record is preflighted before the first output. Destinations must all be new.', 'Outputs are sequential native documents, not a transaction. Failed outputs stay open for inspection; they are never retried automatically.'] };
  if (expected_revision !== rev) fail('REVISION_CHANGED', 'The batch items, recipe, prototype or options changed. Preview the identical batch again.');
  const results = [];let stopped = false;
  for (const p of plans) {
    if (stopped) { results.push({ id: p.item.id, path: p.path, status: 'not_attempted' });continue; }
    try {
      const result = await composeDocument(session, { ...p.input, mode: 'apply', expected_revision: p.preview.revision }, v => pathGuard(v, { mustExist: true }), native, () => verifyRecipeRecord(p.recipe));
      const summary = { id: p.item.id, path: p.path, status: 'completed', document_id: result.document_id, saved: result.saved, changes: result.changes, source_preserved: result.source_preserved, recipe: p.recipe, closed: false };
      results.push(summary);
      if (args.close_outputs) {
        try {
          const d = (await session.call('documents')).documents.find(d => d.document_id === result.document_id);
          if (!d) summary.close_state = 'already_closed';
          else if (d.modified) summary.close_state = 'left_open_modified';
          else { await session.call('close', { document_id: result.document_id, save: false });summary.closed = true;summary.close_state = 'closed'; }
        } catch (e) { summary.close_error = { code: e.code ?? 'NATIVE_ERROR', message: e.message };if (uncertain(e)) stopped = true; }
      }
    } catch (e) {
      results.push({ id: p.item.id, path: p.path, status: 'failed', error: { code: e.code ?? 'NATIVE_ERROR', message: e.message, ...(e.details ? { details: e.details } : {}) } });
      stopped = args.on_error === 'stop' || uncertain(e);
    }
  }
  const counts = { completed: results.filter(r => r.status === 'completed').length, failed: results.filter(r => r.status === 'failed').length, not_attempted: results.filter(r => r.status === 'not_attempted').length };
  return { mode: 'applied', revision: rev, item_count: plans.length, ...counts, stopped, results, transactional: false };
}
