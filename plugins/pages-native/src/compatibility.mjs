import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export function compatibilityReport(local, { evidence, version } = {}) {
  version ??= JSON.parse(readFileSync(new URL('../plugin.json', import.meta.url))).version;
  if (!evidence) {
    try { evidence = JSON.parse(readFileSync(new URL('../docs/native-verification.json', import.meta.url))); }
    catch { evidence = { status: 'unavailable' }; }
  }
  let dictionary_sha256;
  if (local.app_path) {
    try { dictionary_sha256 = createHash('sha256').update(readFileSync(join(local.app_path, 'Contents/Resources/Pages.sdef'))).digest('hex'); } catch {}
  }
  const recorded = Object.fromEntries(['status', 'plugin_version', 'verified_on', 'verified_hosts', 'macos_version', 'pages_version', 'node_version', 'tool_count', 'native_check_count', 'remaining_limits'].filter(k => evidence[k] !== undefined).map(k => [k, evidence[k]]));
  return {
    plugin_version: version,
    local: { ...local, node_version: process.version, ...(dictionary_sha256 ? { dictionary_sha256 } : {}) },
    recorded_verification: recorded,
    environment_matches_record: evidence.status === 'passed' && evidence.plugin_version === version && local.automation_tested === true && local.pages_version === evidence.pages_version && local.macos_version === evidence.macos_version && process.version === evidence.node_version,
    native_acceptance_run_here: false,
    notice: 'Diagnostics and a matching version do not certify this Mac. Run the native acceptance harness on each intended Pages/macOS environment; no document contents are sent over the network.'
  };
}
