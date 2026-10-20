import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const worker = fileURLToPath(new URL('../native/worker.js', import.meta.url));
const textWorker = fileURLToPath(new URL('../native/text.applescript', import.meta.url));
const openWorker = fileURLToPath(new URL('../native/open.applescript', import.meta.url));
const helperActions = new Set(['text_snapshot', 'text_apply', 'text_format', 'cell_formats', 'fill_placeholders']);
export class NativeError extends Error {
  constructor(code, message, details = {}) { super(message); this.code = code; this.details = details; }
}
export class PagesBridge {
  #tail = Promise.resolve();
  #uncertain = false;
  constructor({ timeout = 120_000, spawnProcess = spawn, platform = process.platform, lockPath = join(tmpdir(), `pages-native-${process.getuid?.() ?? 'user'}.lock`) } = {}) {
    Object.assign(this, { timeout, spawnProcess, platform, lockPath });
  }
  call(action, args = {}) { return this.exclusive(session => session.call(action, args)); }
  exclusive(task) {
    const next = this.#tail.then(() => this.#withLock(task));
    this.#tail = next.catch(() => {}); return next;
  }
  async #withLock(task) {
    if (this.platform !== 'darwin') throw new NativeError('MACOS_REQUIRED', 'Native Apple Pages automation requires macOS.');
    if (this.#uncertain) throw new NativeError('STATE_UNCERTAIN', 'A native call did not finish reliably. Inspect Pages before restarting this server. Never automatically retry mutations.');
    try { mkdirSync(this.lockPath, { mode: 0o700 }); }
    catch {
      let owner, alive = true;
      try { owner = Number(readFileSync(join(this.lockPath, 'pid'), 'utf8')); } catch {}
      if (owner > 0) { try { process.kill(owner, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; } }
      throw new NativeError(alive ? 'PAGES_BUSY' : 'STALE_LOCK', alive ? 'Another Pages Native process holds the native lock.' : 'A previous process left a stale lock. Verify Pages is idle before removing it.', { lock: this.lockPath });
    }
    writeFileSync(join(this.lockPath, 'pid'), String(process.pid), { mode: 0o600 });
    try { return await task({ call: (action, args = {}) => this.#invoke(action, args) }); }
    finally { if (!this.#uncertain) rmSync(this.lockPath, { recursive: true }); }
  }
  async #invoke(action, args) {
    if (this.#uncertain) throw new NativeError('STATE_UNCERTAIN', 'Inspect Pages before restarting this server.');
    const request = JSON.stringify({ action, args });
    let folder, argv = ['-l', 'JavaScript', worker];
    if (helperActions.has(action) || action === 'open') {
      folder = mkdtempSync(join(tmpdir(), 'pages-native-request-'));
      const path = join(folder, 'request.json'); writeFileSync(path, request, { mode: 0o600 });
      argv = [action === 'open' ? openWorker : textWorker, path];
    }
    try {
      return await new Promise((resolve, reject) => {
        const child = this.spawnProcess('/usr/bin/osascript', argv, { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
        let output = '', diagnostic = '', timedOut = false;
        const timer = setTimeout(() => { timedOut = true; this.#uncertain = true; child.kill('SIGKILL'); }, this.timeout);
        child.stdout.on('data', d => { output += d; if (output.length > 16 * 1024 * 1024) { this.#uncertain = true; child.kill('SIGKILL'); } });
        child.stderr.on('data', d => { diagnostic = (diagnostic + d).slice(-3000); });
        child.stdin.on('error', () => {});
        child.on('error', e => { clearTimeout(timer); reject(new NativeError('NATIVE_PROCESS_START_FAILED', e.message)); });
        child.on('close', code => {
          clearTimeout(timer);
          if (timedOut) return reject(new NativeError('NATIVE_TIMEOUT', 'Pages timed out. Edits may have partially applied. Inspect the document before restarting.'));
          if (this.#uncertain) return reject(new NativeError('NATIVE_OUTPUT_LIMIT', 'Native response exceeded its limit; inspect Pages.'));
          if (code !== 0) { this.#uncertain = true; return reject(new NativeError('NATIVE_PROCESS_FAILED', 'Native automation failed; inspect Pages before restarting.', { diagnostic })); }
          let response;
          try { response = JSON.parse(output); }
          catch { this.#uncertain = true; return reject(new NativeError('INVALID_NATIVE_RESPONSE', 'Native response could not be decoded; inspect Pages before restarting.', { diagnostic })); }
          if (!response.ok) {
            if (['APPLE_EVENT_TIMEOUT', 'OPEN_PENDING'].includes(response.error.code)) this.#uncertain = true;
            return reject(new NativeError(response.error.code, response.error.message, response.error.details));
          }
          resolve(response.result);
        });
        child.stdin.end(folder ? '' : request);
      });
    } finally { if (folder) rmSync(folder, { recursive: true, force: true }); }
  }
}
