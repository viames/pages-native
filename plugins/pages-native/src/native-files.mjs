import { lstatSync, readdirSync, mkdirSync, copyFileSync, constants, openSync, readSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { NativeError } from './bridge.mjs';

// Copy opaque Pages bytes/packages. Never parse or rewrite the private format.
function inventory(path, relative = '') {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new NativeError('UNSUPPORTED_TEMPLATE_ENTRY', 'Native prototypes must contain only regular files/directories, without symlinks.');
  const own = [[relative, stat.isDirectory() ? 'directory' : 'file', stat.size, stat.mtimeMs]];
  return stat.isDirectory() ? own.concat(readdirSync(path).sort().flatMap(name => inventory(join(path, name), relative + '/' + name))) : own;
}
function copy(from, to) {
  if (lstatSync(from).isDirectory()) {
    mkdirSync(to, { mode: 0o700 });
    for (const name of readdirSync(from)) copy(join(from, name), join(to, name));
  } else copyFileSync(from, to, constants.COPYFILE_EXCL);
}
export function copyNativePrototype(from, to) {
  const before = JSON.stringify(inventory(from));
  copy(from, to);
  if (JSON.stringify(inventory(from)) !== before) throw new NativeError('TEMPLATE_CHANGED_DURING_COPY', 'The source changed while copying. Inspect the new copy before opening it.', { path: to });
}
export function nativeFingerprint(path, { identity = false } = {}) {
  const hash = createHash('sha256');
  function visit(current, relative) {
    const s = lstatSync(current);
    if (s.isSymbolicLink() || (!s.isFile() && !s.isDirectory())) throw new NativeError('UNSUPPORTED_TEMPLATE_ENTRY', 'Native documents must not contain symlinks/special entries.');
    hash.update(JSON.stringify([relative, s.isDirectory() ? 'directory' : 'file', ...(identity ? [s.dev, s.ino, s.mtimeMs, s.size] : [])]));
    if (s.isDirectory()) for (const name of readdirSync(current).sort()) visit(join(current, name), relative + '/' + name);
    else {
      const content = createHash('sha256'), fd = openSync(current, 'r'), buffer = Buffer.allocUnsafe(64 * 1024);
      try { let n; while ((n = readSync(fd, buffer, 0, buffer.length, null)) > 0) content.update(buffer.subarray(0, n)); }
      finally { closeSync(fd); }
      hash.update(content.digest());
    }
  }
  visit(path, ''); return hash.digest('hex');
}
