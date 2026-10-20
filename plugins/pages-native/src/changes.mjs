import { NativeError } from './bridge.mjs';

export const guardedActions = new Set(['format_text', 'table', 'write_cells', 'format_cells', 'sort_table', 'merge_cells', 'table_dimensions', 'object', 'settings']);

export function changeNotice(action, args) {
  const notices = ['Checks cover API-visible state only. Apple Events are not transactional; a native error can leave partial changes.'];
  if (args.operation === 'delete') notices.push('Deleting this item removes its content.');
  if (action === 'table' && args.operation === 'update') notices.push('Shrinking a table can discard cells; review its current dimensions and content.');
  if (action === 'merge_cells' && args.operation === 'merge') notices.push('Merging can discard values outside the first cell.');
  if (action === 'sort_table') notices.push('Sorting changes row order and may affect formulas.');
  return notices;
}

export function validateTextFormat(args, snapshot) {
  if (args.last > snapshot.characters.length) throw new NativeError('TEXT_RANGE', 'Formatting range exceeds native characters.');
  for (const key of ['fonts', 'sizes', 'colors']) {
    if (!Array.isArray(snapshot[key]) || snapshot[key].length !== snapshot.characters.length) throw new NativeError('STYLE_SNAPSHOT_INVALID', 'Native style readback is incomplete; no formatting was applied.');
  }
}
