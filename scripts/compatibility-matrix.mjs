import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function compatibilityMatrix(reports) {
  const unique = new Map(), configurations = new Map();
  for (const r of reports) {
    if (r.schema_version !== 1 || !/^[a-f0-9-]{36}$/.test(r.report_id ?? '') || !['passed', 'failed'].includes(r.status) || r.native_tests_executed !== true || !/^\d+\.\d+\.\d+/.test(r.plugin_version ?? '')) throw new Error('Invalid native report identity or execution status.');
    for (const k of ['bundle_sha256', 'native_sha256', 'harness_sha256']) if (!/^[a-f0-9]{64}$/.test(r[k] ?? '')) throw new Error(`Invalid ${k}.`);
    for (const k of ['pages_version', 'macos_version', 'node_version']) if (typeof r.environment?.[k] !== 'string' || r.environment[k].length > 80) throw new Error(`Invalid environment ${k}.`);
    if (!Array.isArray(r.checks) || !r.checks.length || r.checks.length > 500 || r.checks.some(c => typeof c !== 'string' || c.length > 180) || r.check_count !== r.checks.length) throw new Error('Invalid native check list.');
    if (unique.has(r.report_id)) {
      if (JSON.stringify(unique.get(r.report_id)) !== JSON.stringify(r)) throw new Error('Conflicting duplicate report ID.');
      continue;
    }
    unique.set(r.report_id, r);
    const key = JSON.stringify([r.plugin_version, r.bundle_sha256, r.native_sha256, r.harness_sha256, r.environment.pages_version, r.environment.macos_version, r.environment.node_version]);
    if (!configurations.has(key)) configurations.set(key, { plugin_version: r.plugin_version, bundle_sha256: r.bundle_sha256, native_sha256: r.native_sha256, harness_sha256: r.harness_sha256, environment: { pages_version: r.environment.pages_version, macos_version: r.environment.macos_version, node_version: r.environment.node_version }, passed_runs: 0, failed_runs: 0, checks: [], report_ids: [] });
    const config = configurations.get(key);
    config[r.status === 'passed' ? 'passed_runs' : 'failed_runs']++;
    if (r.status === 'passed') config.checks = [...new Set([...config.checks, ...r.checks])].sort();
    config.report_ids.push(r.report_id);
  }
  return { schema_version: 1, report_count: unique.size, configuration_count: configurations.size, configurations: [...configurations.values()], notice: 'Reports describe explicit native test runs and exact code/environment fingerprints. Repeated runs do not prove different physical Macs; portable CI and diagnostics do not count as native acceptance. Reports are evidence supplied by testers, not signed certification.' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const paths = process.argv.slice(2);
  if (!paths.length) throw new Error('Usage: node scripts/compatibility-matrix.mjs report.json [report2.json ...]');
  console.log(JSON.stringify(compatibilityMatrix(paths.map(path => {
    const text = readFileSync(path, 'utf8');
    if (text.length > 1_000_000) throw new Error('Native report exceeds the size limit.');
    return JSON.parse(text);
  })), null, 2));
}
