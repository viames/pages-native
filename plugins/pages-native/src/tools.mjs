import { z } from 'zod';
import { NativeError } from './bridge.mjs';
import { canonicalPath, configuredRoots, parseRange, columnName } from './paths.mjs';
import { copyNativePrototype, nativeFingerprint } from './native-files.mjs';
import { previewPaths } from './previews.mjs';
import { revision, planTextEdits } from './text-edits.mjs';
import { guardedActions, changeNotice, validateTextFormat } from './changes.mjs';
import { compatibilityReport } from './compatibility.mjs';
import { searchDocument } from './search.mjs';
import { composeDocument } from './composition.mjs';
import { cellValue, fieldValue, compositionField, recipeName, recipeDefinition } from './recipe-schemas.mjs';
import { recipes, changeRecipe, resolveRecipe, verifyRecipeRecord } from './recipes.mjs';
import { recipeHistory } from './recipe-history.mjs';
import { composeBatch } from './batch.mjs';

const str = z.string().min(1).max(4096), id = z.string().min(1).max(512), integer = z.number().int().positive();
const document = { document_id: id }, table = { ...document, table: integer };
const color = z.tuple([z.number().int().min(0).max(65535), z.number().int().min(0).max(65535), z.number().int().min(0).max(65535)]);
const target = z.strictObject({ kind: z.enum(['body', 'section', 'page', 'text', 'shape']), index: integer.optional() });
const textTarget = { ...document, target: target.default({ kind: 'body' }) };
const content = z.string().max(100000);
const geometry = { x: z.number().finite().optional(), y: z.number().finite().optional(), width: z.number().positive().max(10000).optional(), height: z.number().positive().max(10000).optional(), locked: z.boolean().optional() };
const edit = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('replace'), find: z.string().min(1).max(100000), replacement: content, occurrence: z.union([integer, z.literal('all')]).default(1), expected_count: z.number().int().min(0).max(100000).optional() }),
  z.strictObject({ kind: z.literal('range'), start: integer, delete_count: z.number().int().min(0), text: content })
]);
const cell = cellValue;
const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const write = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
const guard = { mode: z.enum(['preview', 'apply']).default('preview'), expected_revision: z.string().regex(/^[a-f0-9]{64}$/).optional() };
const spec = (name, description, shape, readonly = false) => ({ name: `pages_${name}`, action: name, description: description + (guardedActions.has(name) ? ' Defaults to preview; apply the identical request with expected_revision. Rechecks exposed native state before writing.' : ''), schema: z.strictObject({ ...shape, ...(guardedActions.has(name) ? guard : {}) }), annotations: readonly ? read : write });
const explicitTarget = target.refine(t => t.kind === 'body' ? t.index === undefined : t.index !== undefined, 'Supply an index for non-body targets only.');
const field = compositionField;
export const tools = [
  spec('status', 'Check Pages installation and native Automation. launch=false avoids launching a stopped app.', { launch: z.boolean().default(false) }, true),
  spec('diagnostics', 'Read local Pages/API/PDFKit diagnostics. No document contents or network request.', { launch: z.boolean().default(false) }, true),
  spec('compatibility', 'Compare local Pages/macOS/runtime diagnostics with recorded native evidence. Does not certify this Mac or change documents.', { launch: z.boolean().default(false) }, true),
  spec('documents', 'List open native Pages documents and their explicit IDs.', {}, true),
  spec('templates', 'List native installed Pages templates with stable IDs and localized names.', {}, true),
  spec('open', 'Open an existing native .pages document. No conversion.', { path: str }),
  spec('create', 'Create a new .pages document from the native blank or an exact built-in template ID. Initial text replaces the new body only.', { path: str, template_id: str.optional(), text: content.optional() }),
  spec('from_template', 'Copy an opaque custom .pages prototype to a new path and open the copy. Reject unsaved open source changes; never save the source.', { source_path: str, path: str }),
  spec('search', 'Search literal text in API-exposed native text targets and formatted table cells, optionally formulas. Returns native-character positions for text and explicit table/cell references. Read only; no document format parsing. Limits: 100 targets, 2,000 cells, 100,000 total text characters. Scope overlap is reported, not deduplicated.', { ...document, query: z.string().min(1).max(10000), scopes: z.array(z.enum(['body', 'section', 'page', 'text', 'shape', 'table'])).min(1).max(6).default(['body', 'text', 'shape', 'table']), text_targets: z.array(explicitTarget).min(1).max(100).optional(), table_ranges: z.array(z.strictObject({ table: integer, range: str })).min(1).max(100).optional(), case_sensitive: z.boolean().default(true), include_formulas: z.boolean().default(false), context: z.number().int().min(0).max(200).default(40), offset: z.number().int().min(0).max(1000000).default(0), max_results: integer.max(200).default(50) }, true),
  spec('compose', 'Preview/apply a guided recipe on a NEW opaque copy of a saved custom .pages prototype. Typed required/default values, exact literal occurrences OR native placeholder tags, optionally combined with explicit native table cells. Never edits/saves the source. Apply needs identical fields/paths and revision. On failure inspect the copy; operations are not transactional. Preview may briefly open the source for native reads.', { source_path: str, path: str, fields: z.array(field).min(1).max(100), ...guard }),
  spec('recipes', 'List a local reusable recipe library, or read a named definition and its revision. No Pages launch, document parsing or network.', { library_path: str, name: recipeName.optional() }, true),
  spec('recipe', 'Preview/apply saving or deleting local recipe JSON. Stores definitions/defaults and a saved prototype fingerprint, never last-use values. Preserves immutable recipe history and deduplicated opaque prototypes. Restore creates a new current revision; delete retains history. Source paths are relative to the library for portability. Does not open or save Pages.', { library_path: str, name: recipeName, operation: z.enum(['save', 'delete', 'restore']), version: integer.optional(), recipe: recipeDefinition.optional(), ...guard }),
  spec('recipe_history', 'List immutable recipe revisions and deletion events, read one revision, or compare definition fields/description/prototype fingerprints. Reads local JSON only. Old pre-history prototype bytes may be unavailable.', { library_path: str, name: recipeName, version: integer.optional(), compare_version: integer.optional() }, true),
  spec('compose_batch', 'Preview/apply up to 10 sequential NEW native documents from one current or historical saved recipe. All records are preflighted before any output. No overwrites or automatic retries. Per-item results; stop on error by default and always stop on uncertain native state.', { library_path: str, name: recipeName, version: integer.optional(), source_path: str.optional(), items: z.array(z.strictObject({ id: id, path: str, values: z.array(z.strictObject({ name: id, value: fieldValue })).max(100).default([]) })).min(1).max(10), on_error: z.enum(['stop', 'continue']).default('stop'), close_outputs: z.boolean().default(true), ...guard }),
  spec('compose_recipe', 'Preview/apply a NEW native document from a saved recipe. Supply only field values; defaults/bindings come from the local library. Checks recipe revision and prototype bytes. An explicit source_path override relocates identical prototype bytes. Never edits the source.', { library_path: str, name: recipeName, version: integer.optional(), path: str, source_path: str.optional(), values: z.array(z.strictObject({ name: id, value: fieldValue })).max(100).default([]), ...guard }),
  spec('save', 'Save an already saved native document in place. Use create for new documents.', document),
  spec('close', 'Close an explicit document. save=true saves first; save=false explicitly discards unsaved changes.', { ...document, save: z.boolean() }),
  spec('inspect', 'Read native layout mode, page/section counts, tables and object counts.', document, true),
  spec('settings', 'Read or change the native facing-pages setting. Body/layout mode conversion is not exposed.', { ...document, facing_pages: z.boolean().optional() }),
  spec('read_text', 'Read native text, character boundaries and paragraphs. Optional per-character native styles are bounded to 10,000 characters. Indices are 1-based.', { ...textTarget, include_styles: z.boolean().default(false) }, true),
  spec('edit_text', 'Preview literal or native-character range edits. Apply requires the identical request plus expected_revision. Uses native text ranges; not an atomic rollback.', { ...textTarget, operations: z.array(edit).min(1).max(200), mode: z.enum(['preview', 'apply']).default('preview'), expected_revision: z.string().regex(/^[a-f0-9]{64}$/).optional() }),
  spec('format_text', 'Set native font name, point size or RGB color on an explicit native character interval. Bold/italic use an appropriate font face.', { ...textTarget, first: integer, last: integer, style: z.strictObject({ font_name: str.optional(), font_size: z.number().positive().max(1000).optional(), color: color.optional() }) }),
  spec('placeholders', 'List script-tagged placeholder text exposed by the native document collection.', document, true),
  spec('fill_placeholders', 'Preview/apply exact script-tag replacements in templates. Requires a revision for apply; duplicate tags require expected_count.', { ...document, fields: z.array(z.strictObject({ tag: str, text: content, expected_count: integer.optional() })).min(1).max(100), mode: z.enum(['preview', 'apply']).default('preview'), expected_revision: z.string().regex(/^[a-f0-9]{64}$/).optional() }),
  spec('table', 'Create, update/resize or delete a native table. Indices identify the document-wide table collection. Shrinking/deleting can remove data.', { ...document, operation: z.enum(['create', 'update', 'delete']), table: integer.optional(), page: integer.optional(), name: str.optional(), rows: integer.max(1000).optional(), columns: integer.max(100).optional(), header_rows: z.number().int().min(0).max(5).optional(), header_columns: z.number().int().min(0).max(5).optional(), footer_rows: z.number().int().min(0).max(5).optional(), ...geometry }),
  spec('read_cells', 'Read up to 2,000 native table cells, with formulas, calculated values and exact base formats.', { ...table, range: str }, true),
  spec('write_cells', 'Write a rectangular native table range. Boolean cells/checkbox controls are not supported by Pages. Strings are literal; formulas use {formula:"=..."}; dates use {date:"ISO"}. Preserves compatible base formats and verifies readback.', { ...table, start: str, values: z.array(z.array(cell).min(1).max(100)).min(1).max(1000), preserve_format: z.boolean().default(true) }),
  spec('format_cells', 'Set native range base format, fonts, colors, alignment and wrapping.', { ...table, range: str, format: z.enum(['automatic', 'text', 'number', 'currency', 'percent', 'date and time', 'duration', 'fraction', 'scientific', 'checkbox']).optional(), font_name: str.optional(), font_size: z.number().positive().max(1000).optional(), text_color: color.optional(), background_color: color.optional(), alignment: z.enum(['left', 'center', 'right', 'justified', 'auto']).optional(), vertical_alignment: z.enum(['top', 'center', 'bottom']).optional(), text_wrap: z.boolean().optional() }),
  spec('sort_table', 'Sort native table rows by an explicit 1-based column. Inspect formulas and row ordering afterwards.', { ...table, column: integer, direction: z.enum(['ascending', 'descending']) }),
  spec('merge_cells', 'Merge or unmerge an explicit native table range; merging can discard cell contents.', { ...table, range: str, operation: z.enum(['merge', 'unmerge']) }),
  spec('table_dimensions', 'Set row height or column width for a bounded 1-based native axis interval.', { ...table, axis: z.enum(['row', 'column']), first: integer, last: integer, size: z.number().positive().max(10000) }),
  spec('objects', 'List document-wide native text, shape, image, chart, line and group indices and geometry.', document, true),
  spec('object', 'Create text/shape/image on a page, or update/delete existing native object geometry. Existing rich text should be changed through edit_text. Chart series/type/title are not exposed.', { ...document, operation: z.enum(['create', 'update', 'delete']), kind: z.enum(['text', 'shape', 'image', 'chart', 'line', 'group']), index: integer.optional(), page: integer.optional(), text: content.optional(), source_path: str.optional(), description: content.optional(), font_name: str.optional(), font_size: z.number().positive().max(1000).optional(), color: color.optional(), rotation: z.number().int().min(0).max(359).optional(), opacity: z.number().int().min(0).max(100).optional(), ...geometry }),
  spec('export', 'Explicit native PDF, plain text, RTF, EPUB or Word export to a new path; editing remains native .pages.', { ...document, path: str, format: z.enum(['pdf', 'txt', 'rtf', 'epub', 'docx']), options: z.strictObject({ title: str.optional(), author: str.optional(), language: str.optional(), publisher: str.optional(), genre: str.optional(), cover: z.boolean().optional(), fixed_layout: z.boolean().optional(), image_quality: z.enum(['Good', 'Better', 'Best']).optional(), include_comments: z.boolean().optional(), include_annotations: z.boolean().optional() }).optional() }),
  spec('preview', 'Export native PDF and render a selected page to PNG through macOS PDFKit, without screenshots or Accessibility. Both paths must be new.', { ...document, path: str, page: integer.default(1), max_dimension: integer.min(200).max(2400).default(1200) }),
  spec('backup', 'Copy the saved native bytes/package to a new .pages path and verify its hash. Modified documents require explicit save_first=true.', { ...document, path: str, save_first: z.boolean().default(false) })
];

const invalid = (code, message, details) => { throw new NativeError(code, message, details); };
export class PagesTools {
  constructor(bridge, { roots = configuredRoots() } = {}) { this.bridge = bridge; this.roots = roots; }
  path(value, options = {}) { return canonicalPath(value, { roots: this.roots, ...options }); }
  async execute(name, input) {
    const tool = tools.find(t => t.name === name); if (!tool) invalid('UNKNOWN_TOOL', 'Unknown Pages Native tool.');
    let args = tool.schema.parse(input), action = tool.action, recipeRecord, beforeCopy;
    if (['recipes', 'recipe', 'recipe_history', 'compose_batch', 'compose_recipe'].includes(action)) {
      args.library_path = this.path(args.library_path);
      if (action === 'recipes') return recipes(args.library_path, args.name);
      if (action === 'recipe_history') return recipeHistory(args.library_path, args.name, args.version, args.compare_version);
      if (action === 'compose_batch') return this.bridge.exclusive(session => composeBatch(session, args, (value, options) => this.path(value, options), (name, input) => this.native(session, name, input)));
      if (action === 'recipe') return changeRecipe(args, (value, options) => this.path(value, options));
      const resolved = resolveRecipe(args, (value, options) => this.path(value, options));
      recipeRecord = { library_path: args.library_path, name: args.name, version: resolved.record.recipe.version, revision: resolved.record.revision, ...(args.version !== undefined ? { history_version: args.version } : {}) };
      beforeCopy = () => verifyRecipeRecord(recipeRecord);
      args = { source_path: resolved.source_path, path: args.path, fields: resolved.fields, mode: args.mode, expected_revision: args.expected_revision, _recipe: recipeRecord };
      action = 'compose';
    }
    if (args.target && args.target.kind !== 'body' && !args.target.index) invalid('TARGET_INDEX_REQUIRED', 'This native text target requires a 1-based index.');
    if (args.target?.kind === 'body' && args.target.index !== undefined) invalid('INVALID_TARGET', 'The document body has no index.');
    if (['open', 'create', 'from_template', 'compose', 'backup'].includes(action)) args.path = this.path(args.path, { extensions: ['.pages'], ...(action === 'open' ? { mustExist: true } : { mustBeNew: true }) });
    if (['from_template', 'compose'].includes(action)) args.source_path = this.path(args.source_path, { extensions: ['.pages'], mustExist: true });
    if (action === 'preview') Object.assign(args, previewPaths(args.path, this.roots));
    if (action === 'export') {
      args.path = this.path(args.path, { extensions: [`.${args.format}`], mustBeNew: true });
      if (args.options) args.options = Object.fromEntries(Object.entries(args.options).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), v]));
    }
    if (['read_cells', 'format_cells', 'merge_cells'].includes(action)) this.range(args.range);
    if (action === 'search') {
      if (new Set(args.scopes).size !== args.scopes.length) invalid('DUPLICATE_SCOPE', 'Choose each search scope once.');
      if (args.text_targets?.some(t => !args.scopes.includes(t.kind))) invalid('SEARCH_SCOPE', 'Each explicit text target must belong to a selected scope.');
      if (args.table_ranges && !args.scopes.includes('table')) invalid('SEARCH_SCOPE', 'table_ranges requires the table scope.');
      for (const r of args.table_ranges ?? []) this.range(r.range);
    }
    if (action === 'format_text' && (!Object.keys(args.style).length || args.last < args.first)) invalid('INVALID_STYLE', 'Supply a font/size/color and a valid native character interval.');
    if (action === 'format_cells' && args.format === 'checkbox') invalid('UNSUPPORTED_NATIVE_API', 'Checkbox controls are Numbers-only; Pages rejects this native format.');
    if (action === 'format_cells' && !['format', 'font_name', 'font_size', 'text_color', 'background_color', 'alignment', 'vertical_alignment', 'text_wrap'].some(k => args[k] !== undefined)) invalid('INVALID_STYLE', 'Supply at least one native cell-format property.');
    if (action === 'write_cells') {
      if (args.values.some(row => row.some(v => typeof v === 'boolean'))) invalid('UNSUPPORTED_NATIVE_API', 'Pages coerces boolean cells to numbers. Supply an explicit number or literal text; no cells were written.');
      const start = parseRange(args.start); if (args.start.includes(':')) invalid('INVALID_RANGE', 'start must be one cell.');
      if (args.values.some(row => row.length !== args.values[0].length)) invalid('RAGGED_MATRIX', 'Every row must have the same width.');
      const lastRow = start.row + args.values.length - 1, lastColumn = start.column + args.values[0].length - 1;
      args.range = `${columnName(start.column)}${start.row}:${columnName(lastColumn)}${lastRow}`; this.range(args.range); delete args.start;
    }
    if (action === 'table') {
      if (args.operation === 'create' && !args.name) invalid('NAME_REQUIRED', 'Creating a native table requires a name.');
      if (args.operation !== 'create' && !args.table) invalid('TABLE_REQUIRED', 'Supply an explicit table index.');
      if (args.rows !== undefined && (args.header_rows ?? 0) + (args.footer_rows ?? 0) >= args.rows) invalid('TABLE_LAYOUT', 'Leave at least one body row.');
      if (args.columns !== undefined && (args.header_columns ?? 0) >= args.columns) invalid('TABLE_LAYOUT', 'Leave at least one body column.');
    }
    if (action === 'object') {
      if (args.operation === 'create' && !['text', 'shape', 'image'].includes(args.kind)) invalid('UNSUPPORTED_NATIVE_API', 'Only text items, shapes and images can be created by this tool.');
      if (args.operation !== 'create' && !args.index) invalid('OBJECT_INDEX_REQUIRED', 'Supply a native object index.');
      if (args.operation !== 'create' && args.text !== undefined) invalid('USE_GUARDED_TEXT_EDIT', 'Use pages_edit_text to preserve existing text outside the edited range.');
      if (args.kind === 'image' && args.operation === 'create') { if (!args.source_path) invalid('IMAGE_PATH_REQUIRED', 'Supply a local image.'); args.source_path = this.path(args.source_path, { extensions: ['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.gif', '.heic', '.pdf'], mustExist: true }); }
      else if (args.source_path) invalid('INVALID_IMAGE_SOURCE', 'source_path is supported only for image creation.');
      if (args.kind === 'chart' && (args.rotation !== undefined || args.opacity !== undefined)) invalid('UNSUPPORTED_NATIVE_API', 'Native chart automation exposes position, dimensions and locking only.');
      if (args.rotation !== undefined && !['text', 'shape', 'image'].includes(args.kind)) invalid('UNSUPPORTED_NATIVE_API', 'Native rotation is exposed only for text items, shapes and images.');
      if (!['text', 'shape'].includes(args.kind) && ['text', 'font_name', 'font_size', 'color'].some(k => args[k] !== undefined)) invalid('UNSUPPORTED_NATIVE_API', 'Text and font properties require a native text item or shape.');
      if (args.kind !== 'image' && args.description !== undefined) invalid('UNSUPPORTED_NATIVE_API', 'Alternative descriptions apply to images only.');
      if (['line', 'group', 'chart'].includes(args.kind) && args.opacity !== undefined) invalid('UNSUPPORTED_NATIVE_API', 'This native object does not expose opacity.');
      if (args.kind === 'group' && args.locked !== undefined) invalid('UNSUPPORTED_NATIVE_API', 'Native groups do not expose locking.');
    }
    return this.bridge.exclusive(async session => {
      if (action === 'compatibility') return compatibilityReport(await session.call('diagnostics', args));
      if (action === 'search') return searchDocument(session, args);
      if (action === 'compose') {
        const result = await composeDocument(session, args, value => canonicalPath(value, { mustExist: true }), (name, input) => this.native(session, name, input), beforeCopy);
        return recipeRecord ? { ...result, recipe: recipeRecord } : result;
      }
      if (action === 'read_text') return this.snapshot(session, args);
      if (guardedActions.has(action) && !(action === 'settings' && args.facing_pages === undefined)) {
        const { mode, expected_revision, ...request } = args;
        const before = action === 'format_text'
          ? await this.snapshot(session, { ...request, include_styles: true })
          : await session.call('change_snapshot', { document_id: request.document_id, action, request });
        if (action === 'format_text') validateTextFormat(request, before);
        let base_formats;
        if (action === 'write_cells') {
          base_formats = (await session.call('cell_formats', request)).formats;
          if (request.preserve_format && base_formats.includes('other')) invalid('UNSUPPORTED_NATIVE_FORMAT', 'An unrecognized native cell format requires deliberate preserve_format=false.');
        }
        const source_fingerprint = action === 'object' && request.source_path ? nativeFingerprint(request.source_path) : undefined;
        const expected = revision({ action, request, before, base_formats, ...(source_fingerprint ? { source_fingerprint } : {}) });
        if (mode === 'preview') return { mode, action, revision: expected, before, requested: request, notices: changeNotice(action, request), ...(base_formats ? { base_formats } : {}), ...(source_fingerprint ? { source_fingerprint } : {}) };
        if (expected_revision !== expected) invalid('REVISION_CHANGED', 'Preview the identical request again. Native content, formatting, geometry, source image or operation changed.');
        const result = await this.native(session, action, { ...request, [action === 'format_text' ? '_expected_style' : '_expected_state']: before });
        return { ...result, mode: 'applied', action, revision: expected, guard_verified: true };
      }
      if (action === 'edit_text') {
        const snapshot = await this.snapshot(session, args), plan = planTextEdits(snapshot, args.operations);
        const expected = revision({ document_id: args.document_id, target: args.target, snapshot, operations: args.operations });
        if (args.mode === 'preview') return { mode: 'preview', revision: expected, changes: plan.changes, before: snapshot.text, after: plan.after, native_character_count: snapshot.characters.length, style_scope: 'Replacements use native rich-text ranges; no whole-body rewrite. New text inherits native insertion formatting. Revision guards text, not style changes.' };
        if (args.expected_revision !== expected) invalid('REVISION_CHANGED', 'Preview the identical request again. Text, target or operations changed.');
        const result = await session.call('text_apply', { document_id: args.document_id, target: args.target, expected_text: snapshot.text, edits: plan.edits });
        if (result.text !== plan.after) invalid('TEXT_POSTCHECK_FAILED', 'Native text differs from the planned result. Edits may already have applied; inspect the document.');
        return { mode: 'applied', changes: plan.changes, ...result };
      }
      if (action === 'fill_placeholders') {
        const before = await session.call('placeholders', { document_id: args.document_id }), replacements = [], tags = new Set();
        for (const f of args.fields) {
          if (tags.has(f.tag)) invalid('DUPLICATE_TAG', 'Use one replacement per script tag.'); tags.add(f.tag);
          const matches = before.placeholders.filter(p => p.tag === f.tag);
          if (!matches.length) invalid('PLACEHOLDER_NOT_FOUND', 'No native placeholder has this exact tag.', { tag: f.tag });
          if ((f.expected_count !== undefined && matches.length !== f.expected_count) || (matches.length > 1 && f.expected_count === undefined)) invalid('MATCH_COUNT', 'Declare the exact expected_count for duplicate tags.', { tag: f.tag, actual: matches.length });
          replacements.push(...matches.map(p => ({ index: p.index, tag: p.tag, before: p.text, text: f.text })));
        }
        const rev = revision({ document_id: args.document_id, before, fields: args.fields });
        if (args.mode === 'preview') return { mode: 'preview', revision: rev, replacements };
        if (args.expected_revision !== rev) invalid('REVISION_CHANGED', 'Native placeholders or fields changed. Preview again.');
        return session.call('fill_placeholders', { document_id: args.document_id, replacements: replacements.sort((a, b) => b.index - a.index), _expected_placeholders: before });
      }
      if (action === 'from_template') {
        const docs = await session.call('documents');
        if (docs.documents.some(d => d.path && canonicalPath(d.path, { mustExist: true }) === args.source_path && d.modified)) invalid('SOURCE_HAS_UNSAVED_CHANGES', 'Save the source deliberately before using it as a prototype.');
        const fingerprint = nativeFingerprint(args.source_path); copyNativePrototype(args.source_path, args.path);
        if (nativeFingerprint(args.source_path) !== fingerprint || nativeFingerprint(args.path) !== fingerprint) invalid('COPY_VERIFICATION_FAILED', 'The prototype copy changed; inspect both paths.');
        return { ...await session.call('open', { path: args.path }), source_path: args.source_path, source_saved: false, opaque_copy_verified: true };
      }
      if (action === 'backup') {
        let d = await session.call('inspect', { document_id: args.document_id });
        if (d.modified && !args.save_first) invalid('UNSAVED_CHANGES', 'Save deliberately or set save_first=true before backing up current native bytes.');
        if (!d.path) invalid('UNSAVED_DOCUMENT', 'Save this native document before backing it up.');
        if (args.save_first) d = await session.call('save', { document_id: args.document_id });
        const source = this.path(d.path, { extensions: ['.pages'], mustExist: true }), hash = nativeFingerprint(source);
        copyNativePrototype(source, args.path);
        if (nativeFingerprint(source) !== hash || nativeFingerprint(args.path) !== hash) invalid('COPY_VERIFICATION_FAILED', 'Native backup verification failed; inspect both paths.');
        return { path: args.path, source_path: source, sha256: hash, verified: true };
      }
      if (action === 'save') { const d = await session.call('inspect', args); if (!d.path) invalid('UNSAVED_DOCUMENT', 'Save requires an existing native document path.'); this.path(d.path, { extensions: ['.pages'], mustExist: true }); }
      if (action === 'close' && args.save) { const d = await session.call('inspect', args); if (!d.path) invalid('UNSAVED_DOCUMENT', 'Save before closing.'); this.path(d.path, { extensions: ['.pages'], mustExist: true }); }
      return this.native(session, action, args);
    });
  }
  async native(session, action, args) {
      if (action === 'format_text') return session.call('text_format', args);
      if (action === 'write_cells') {
        args._formats = (await session.call('cell_formats', args)).formats;
        if (args.preserve_format && args._formats.includes('other')) invalid('UNSUPPORTED_NATIVE_FORMAT', 'An unrecognized native cell format requires deliberate preserve_format=false.');
      }
      const result = await session.call(action, args);
      if (['read_cells', 'write_cells', 'format_cells'].includes(action)) {
        const formats = (await session.call('cell_formats', args)).formats;
        const cells = result.cells?.flat() ?? [];
        if (cells.length !== formats.length) invalid('FORMAT_READBACK_MISMATCH', 'Native range size changed during readback.');
        cells.forEach((c, i) => { c.format = formats[i]; });
        if (result.format_expectations) {
          const failed = cells.findIndex((c, i) => result.format_expectations[i] && c.format !== result.format_expectations[i]);
          if (failed >= 0) invalid('FORMAT_POSTCHECK_FAILED', 'Cell values may be written but their base format differs; inspect the native range.', { address: cells[failed].address });
          delete result.format_expectations; result.formats_verified = true;
        }
      }
      return result;
  }
  range(value) { const bounds = parseRange(value); if (bounds.count > 2000) invalid('CELL_LIMIT', 'Use at most 2,000 native table cells per call.'); return bounds; }
  async snapshot(session, args) { return session.call('text_snapshot', { document_id: args.document_id, target: args.target, include_styles: args.include_styles ?? false }); }
}
