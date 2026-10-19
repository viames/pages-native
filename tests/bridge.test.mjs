import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PagesBridge } from '../plugins/pages-native/src/bridge.mjs';

function context(delay = 10) {
  const folder = mkdtempSync(join(tmpdir(), 'pages-bridge-unit-'));
  const state = { active: 0, maximum: 0, requests: [] };
  const spawnProcess = (program, argv, options) => {
    assert.equal(program, '/usr/bin/osascript'); assert.equal(options.shell, false);
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    let timer, bytes = '';
    child.stdin = new Writable({ write(chunk, encoding, cb) { bytes += chunk; cb(); } });
    child.stdin.on('finish', () => {
      const request = JSON.parse(bytes); state.requests.push(request);
      state.active++; state.maximum = Math.max(state.maximum, state.active);
      timer = setTimeout(() => {
        state.active--; child.stdout.end(JSON.stringify({ ok: true, result: { action: request.action } })); child.emit('close', 0);
      }, delay);
    });
    child.kill = () => { clearTimeout(timer); state.active--; child.emit('close', null); };
    return child;
  };
  const options = { spawnProcess, platform: 'darwin', lockPath: join(folder, 'lock'), timeout: 1000 };
  return { folder, state, options, clean() { rmSync(folder, { recursive: true, force: true }); } };
}
test('native calls serialize, preserve JSON data and release their lock', async () => {
  const c = context();
  try {
    const bridge = new PagesBridge(c.options);
    const secretText = '\"; application("Finder").delete() // 日本語 $(echo hi)';
    const results = await Promise.all([bridge.call('first', { text: secretText }), bridge.call('second')]);
    assert.deepEqual(results.map(x => x.action), ['first', 'second']);
    assert.equal(c.state.maximum, 1); assert.equal(c.state.requests[0].args.text, secretText);
    assert.equal(existsSync(c.options.lockPath), false);
  } finally { c.clean(); }
});
test('a second bridge cannot operate while another process lock is live', async () => {
  const c = context(30);
  try {
    const a = new PagesBridge(c.options), b = new PagesBridge(c.options);
    const first = a.call('first');
    await new Promise(resolve => setTimeout(resolve, 5));
    await assert.rejects(b.call('second'), e => e.code === 'PAGES_BUSY');
    await first; assert.equal(c.state.requests.length, 1);
  } finally { c.clean(); }
});
test('timeout quarantines the server and retains the lock until manual recovery', async () => {
  const c = context(1000);
  try {
    const bridge = new PagesBridge({ ...c.options, timeout: 10 });
    await assert.rejects(bridge.call('mutation'), e => e.code === 'NATIVE_TIMEOUT');
    await assert.rejects(bridge.call('retry'), e => e.code === 'STATE_UNCERTAIN');
    assert.equal(c.state.requests.length, 1); assert.equal(existsSync(c.options.lockPath), true);
  } finally { c.clean(); }
});
test('non-macOS native execution fails before starting a child', async () => {
  const c = context();
  try { await assert.rejects(new PagesBridge({ ...c.options, platform: 'linux' }).call('status'), e => e.code === 'MACOS_REQUIRED'); assert.equal(c.state.requests.length, 0); }
  finally { c.clean(); }
});
test('exclusive native workflows retain the process lock across multiple calls', async () => {
  const c = context(5);
  try {
    const a = new PagesBridge(c.options), b = new PagesBridge(c.options);
    await a.exclusive(async session => {
      await session.call('first');
      await assert.rejects(b.call('outside'), e => e.code === 'PAGES_BUSY');
      await session.call('second');
    });
    assert.deepEqual(c.state.requests.map(r => r.action), ['first', 'second']);
    assert.equal(existsSync(c.options.lockPath), false);
  } finally { c.clean(); }
});
test('native text requests use a private data file, keep content out of argv and remove it afterwards', async () => {
  const { readFileSync, statSync } = await import('node:fs');
  const folder = mkdtempSync(join(tmpdir(), 'pages-private-request-')); let requestPath;
  const hostile = 'Private text " $(command) 👩🏽‍💻';
  const spawnProcess = (program, argv, options) => {
    assert.equal(options.shell, false); assert.ok(argv[0].endsWith('text.applescript')); requestPath = argv[1];
    assert.ok(!argv.join(' ').includes(hostile)); if (process.platform !== 'win32') assert.equal(statSync(requestPath).mode & 0o777, 0o600);
    assert.equal(JSON.parse(readFileSync(requestPath, 'utf8')).args.expected_text, hostile);
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new Writable({ write(c, e, cb) { cb(); } });
    child.stdin.on('finish', () => { child.stdout.end(JSON.stringify({ ok: true, result: { text: 'done' } })); child.emit('close', 0); }); child.kill = () => {};
    return child;
  };
  try { const bridge = new PagesBridge({ spawnProcess, platform: 'darwin', lockPath: join(folder, 'lock') }); await bridge.call('text_apply', { document_id: 'd', expected_text: hostile }); assert.equal(existsSync(requestPath), false); }
  finally { rmSync(folder, { recursive: true, force: true }); }
});
