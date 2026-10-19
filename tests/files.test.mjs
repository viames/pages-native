import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalPath } from '../plugins/pages-native/src/paths.mjs';
import { copyNativePrototype, nativeFingerprint } from '../plugins/pages-native/src/native-files.mjs';
import { PagesTools } from '../plugins/pages-native/src/tools.mjs';
test('opaque native package copies preserve bytes, verify recursively and refuse overwrite', () => {
  const root = mkdtempSync(join(tmpdir(), 'pages-copy-'));
  try { const src = join(root, 'Source.pages'), dst = join(root, 'Copy.pages'); mkdirSync(src); writeFileSync(join(src, 'opaque'), 'not parsed'); const hash = nativeFingerprint(src); copyNativePrototype(src, dst); assert.equal(nativeFingerprint(dst), hash); assert.equal(nativeFingerprint(src), hash); assert.throws(() => copyNativePrototype(src, dst)); assert.equal(readFileSync(join(dst, 'opaque'), 'utf8'), 'not parsed'); }
  finally { rmSync(root, { recursive: true, force: true }); }
});
test('canonical path guards resolve symlink escapes and require new export destinations', () => {
  const root = mkdtempSync(join(tmpdir(), 'pages-paths-'));
  try { const allowed = join(root, 'allowed'), outside = join(root, 'outside'); mkdirSync(allowed); mkdirSync(outside); symlinkSync(outside, join(allowed, 'escape'), process.platform === 'win32' ? 'junction' : 'dir'); assert.throws(() => canonicalPath(join(allowed, 'escape', 'new.pages'), { roots: [allowed] }), e => e.code === 'PATH_NOT_ALLOWED'); const file = join(allowed, 'old.pages'); writeFileSync(file, 'x'); assert.throws(() => canonicalPath(file, { mustBeNew: true }), e => e.code === 'DESTINATION_EXISTS'); }
  finally { rmSync(root, { recursive: true, force: true }); }
});
test('opaque native prototypes reject internal symlinks', () => {
  const root = mkdtempSync(join(tmpdir(), 'pages-opaque-'));
  try { const src = join(root, 'Source.pages'); mkdirSync(src); symlinkSync('/etc/passwd', join(src, 'private')); assert.throws(() => nativeFingerprint(src), e => e.code === 'UNSUPPORTED_TEMPLATE_ENTRY'); assert.throws(() => copyNativePrototype(src, join(root, 'Copy.pages')), e => e.code === 'UNSUPPORTED_TEMPLATE_ENTRY'); }
  finally { rmSync(root, { recursive: true, force: true }); }
});
test('custom prototypes reject unsaved open changes without copying or saving the source', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pages-prototype-')); const calls = [];
  try { const path = join(root, 'Source.pages'); writeFileSync(path, 'source'); const service = new PagesTools({ exclusive: fn => fn({ call: async action => { calls.push(action); return { documents: [{ path, modified: true }] }; } }) }, { roots: [root] }); await assert.rejects(service.execute('pages_from_template', { source_path: path, path: join(root, 'Copy.pages') }), e => e.code === 'SOURCE_HAS_UNSAVED_CHANGES'); assert.deepEqual(calls, ['documents']); assert.equal(readFileSync(path, 'utf8'), 'source'); }
  finally { rmSync(root, { recursive: true, force: true }); }
});
test('backup requires explicit saved state before any copy', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pages-backup-')); const calls = [];
  try { const service = new PagesTools({ exclusive: fn => fn({ call: async action => { calls.push(action); return { modified: true, path: join(root, 'source.pages') }; } }) }, { roots: [root] }); await assert.rejects(service.execute('pages_backup', { document_id: 'd', path: join(root, 'copy.pages') }), e => e.code === 'UNSAVED_CHANGES'); assert.deepEqual(calls, ['inspect']); }
  finally { rmSync(root, { recursive: true, force: true }); }
});
