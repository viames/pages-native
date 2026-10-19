import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, dirname, basename, extname, join, relative } from 'node:path';
import { NativeError } from './bridge.mjs';

export function canonicalPath(value, { extensions, mustExist = false, mustBeNew = false, roots = [] } = {}) {
  if (typeof value !== 'string' || !isAbsolute(value) || /[\0\r\n]/.test(value)) throw new NativeError('INVALID_PATH', 'Use an absolute filesystem path without control characters.');
  if (extensions && !extensions.includes(extname(value).toLowerCase())) throw new NativeError('INVALID_EXTENSION', `Expected ${extensions.join(' or ')}.`);
  const present = existsSync(value);
  if (mustExist && !present) throw new NativeError('FILE_NOT_FOUND', 'The requested file does not exist.');
  if (mustBeNew && present) throw new NativeError('DESTINATION_EXISTS', 'Choose a new destination. Existing files are never overwritten by create, backup or export.');
  const parent = realpathSync(dirname(value));
  if (!statSync(parent).isDirectory()) throw new NativeError('INVALID_PATH', 'The parent must be an existing directory.');
  const canonical = present ? realpathSync(value) : join(parent, basename(value));
  if (roots.length && !roots.some(root => {
    const rel = relative(realpathSync(root), canonical);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  })) throw new NativeError('PATH_NOT_ALLOWED', 'The path is outside PAGES_NATIVE_ALLOWED_ROOTS.');
  return canonical;
}

export function configuredRoots(value = process.env.PAGES_NATIVE_ALLOWED_ROOTS) {
  if (!value) return [];
  const roots = JSON.parse(value);
  if (!Array.isArray(roots) || roots.some(x => typeof x !== 'string' || !isAbsolute(x) || !statSync(x).isDirectory())) throw new Error('PAGES_NATIVE_ALLOWED_ROOTS must be a JSON array of existing absolute directory paths.');
  return roots.map(p => realpathSync(p));
}

export function parseRange(value) {
  const match = /^([A-Z]{1,3})([1-9][0-9]*)(?::([A-Z]{1,3})([1-9][0-9]*))?$/.exec(value);
  if (!match) throw new NativeError('INVALID_RANGE', 'Use table-relative A1 notation, for example A1 or B2:D20.');
  const col = s => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  const result = { column: col(match[1]), row: Number(match[2]), endColumn: col(match[3] ?? match[1]), endRow: Number(match[4] ?? match[2]) };
  if (result.endColumn < result.column || result.endRow < result.row || result.endColumn > 1000 || result.endRow > 1000000) throw new NativeError('INVALID_RANGE', 'Range is reversed or exceeds the plugin address bounds.');
  result.count = (result.endColumn - result.column + 1) * (result.endRow - result.row + 1);
  return result;
}

export function columnName(n) {
  let name = '';
  while (n > 0) { n--; name = String.fromCharCode(65 + n % 26) + name; n = Math.floor(n / 26); }
  return name;
}
