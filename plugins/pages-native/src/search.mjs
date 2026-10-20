import { NativeError } from './bridge.mjs';
import { revision } from './text-edits.mjs';
const fail = (code, message) => { throw new NativeError(code, message); };

// The query is always literal. RegExp supplies Unicode case comparison without
// lowercasing the source and corrupting its native-character offsets.
export function literalMatches(snapshot, query, caseSensitive = true, context = 40) {
  const { text, characters } = snapshot;
  if (!Array.isArray(characters) || characters.join('') !== text) fail('NATIVE_CHARACTER_MAP', 'Inconsistent native character boundaries.');
  const offsets = [0]; for (const c of characters) offsets.push(offsets.at(-1) + c.length);
  const boundaries = new Map(offsets.map((n, i) => [n, i]));
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped, caseSensitive ? 'gu' : 'giu');
  const matches = []; let excluded = 0;
  for (const m of text.matchAll(regex)) {
    const first = boundaries.get(m.index), end = boundaries.get(m.index + m[0].length);
    if (first === undefined || end === undefined) { excluded++; continue; }
    matches.push({ start: first + 1, delete_count: end - first, matched: m[0], context_before: characters.slice(Math.max(0, first - context), first).join(''), context_after: characters.slice(end, end + context).join('') });
  }
  return { matches, excluded };
}

export async function searchDocument(session, args) {
  const inventory = await session.call('search_inventory', args);
  let characterCount = 0, excluded = 0; const matches = [];
  for (const target of inventory.targets) {
    const snapshot = await session.call('text_snapshot', { document_id: args.document_id, target, include_styles: false });
    characterCount += snapshot.characters.length;
    if (characterCount > 100000) fail('SEARCH_LIMIT', 'Search at most 100,000 native characters; restrict text_targets or scopes.');
    const found = literalMatches(snapshot, args.query, args.case_sensitive, args.context);
    excluded += found.excluded;
    const text_revision = revision({ document_id: args.document_id, target, snapshot });
    for (const match of found.matches) matches.push({ document_id: args.document_id, target, ...match, text_revision });
  }
  for (const range of inventory.tables) for (const cell of range.cells.flat()) {
    const channels = [['formatted', String(cell.formatted ?? cell.value ?? '')]];
    if (args.include_formulas && cell.formula) channels.push(['formula', cell.formula]);
    for (const [channel, text] of channels) {
      characterCount += text.length;
      if (characterCount > 100000) fail('SEARCH_LIMIT', 'Search at most 100,000 text characters; restrict table_ranges or scopes.');
      const found = literalMatches({ text, characters: Array.from(text) }, args.query, args.case_sensitive, args.context);
      for (const { start, delete_count, ...match } of found.matches) matches.push({ document_id: args.document_id, table: range.table, table_name: range.name, address: cell.address, channel, ...match });
    }
  }
  const end = args.offset + args.max_results;
  return { query: args.query, matches: matches.slice(args.offset, end), total_matches: matches.length, offset: args.offset, next_offset: end < matches.length ? end : null, native_boundary_exclusions: excluded, scanned: { text_targets: inventory.targets.length, table_ranges: inventory.tables.length, cells: inventory.tables.reduce((n, t) => n + t.cells.flat().length, 0), characters: characterCount }, scope: args.scopes, notices: ['Only API-exposed collections are searched; hidden or unexposed content is excluded.', 'Body, section and page scopes can overlap. Results are a read-time view; preview edits again before applying.', 'Table hits identify cells; their formatted text is not a rich-text editing range.'] };
}
