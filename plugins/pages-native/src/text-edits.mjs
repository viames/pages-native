import { createHash } from 'node:crypto';
import { NativeError } from './bridge.mjs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
// Native JSON dictionaries do not promise key order between worker processes.
export const revision = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function planTextEdits(snapshot, operations) {
  const chars = snapshot.characters;
  if (!Array.isArray(chars) || chars.join('') !== snapshot.text) throw new NativeError('NATIVE_CHARACTER_MAP', 'Pages returned inconsistent native character boundaries.');
  if (chars.length > 100_000) throw new NativeError('TEXT_LIMIT', 'Read or edit a smaller text target (maximum 100,000 native characters).');
  const offsets = [0]; for (const c of chars) offsets.push(offsets.at(-1) + c.length);
  const boundary = new Map(offsets.map((v, i) => [v, i]));
  const edits = [];
  for (const op of operations) {
    if (op.kind === 'range') {
      if (op.start < 1 || op.start > chars.length + 1 || op.delete_count < 0 || op.start - 1 + op.delete_count > chars.length) throw new NativeError('TEXT_RANGE', 'Text range exceeds the native character boundaries.');
      edits.push({ start: op.start, delete_count: op.delete_count, text: op.text });
    } else {
      const matches = []; let from = 0, at;
      while ((at = snapshot.text.indexOf(op.find, from)) !== -1) {
        const end = at + op.find.length;
        if (!boundary.has(at) || !boundary.has(end)) throw new NativeError('TEXT_BOUNDARY', 'A match cuts through a native character. Use complete characters.');
        matches.push({ start: boundary.get(at) + 1, delete_count: boundary.get(end) - boundary.get(at), text: op.replacement });
        from = end;
      }
      if (op.expected_count !== undefined && matches.length !== op.expected_count) throw new NativeError('MATCH_COUNT', 'Literal match count differs from the request.', { expected: op.expected_count, actual: matches.length });
      if (!matches.length) throw new NativeError('TEXT_NOT_FOUND', 'No literal text match was found.');
      if (op.occurrence === 'all') edits.push(...matches);
      else { if ((op.occurrence ?? 1) > matches.length) throw new NativeError('MATCH_COUNT', 'Requested occurrence does not exist.'); edits.push(matches[(op.occurrence ?? 1) - 1]); }
    }
  }
  if (edits.length > 200) throw new NativeError('EDIT_LIMIT', 'Apply at most 200 replacements in one guarded request.');
  edits.sort((a, b) => a.start - b.start);
  for (let i = 1; i < edits.length; i++) if (edits[i].start <= edits[i - 1].start + Math.max(edits[i - 1].delete_count, 1) - 1) throw new NativeError('OVERLAPPING_EDITS', 'Edits overlap or share an insertion position.');
  let after = snapshot.text;
  for (const e of [...edits].reverse()) after = after.slice(0, offsets[e.start - 1]) + e.text + after.slice(offsets[e.start - 1 + e.delete_count]);
  return { edits: [...edits].reverse(), after, changes: edits.length };
}
