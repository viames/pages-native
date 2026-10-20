import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compatibilityMatrix } from '../scripts/compatibility-matrix.mjs';
const report = { schema_version: 1, report_id: '12345678-1234-1234-1234-123456789012', status: 'passed', native_tests_executed: true, plugin_version: '0.2.0', bundle_sha256: 'a'.repeat(64), native_sha256: 'b'.repeat(64), harness_sha256: 'c'.repeat(64), environment: { pages_version: '14.5', macos_version: '27.0.1', node_version: 'v24.19.0' }, check_count: 1, checks: ['native text revision rejection'] };
test('matrix deduplicates identical reports and separates actual code and environment fingerprints', () => {
  const r2 = { ...report, report_id: '22345678-1234-1234-1234-123456789012', environment: { ...report.environment, pages_version: '15.4' } };
  const r3 = { ...report, report_id: '32345678-1234-1234-1234-123456789012', bundle_sha256: 'd'.repeat(64), status: 'failed' };
  const matrix = compatibilityMatrix([report, report, r2, r3]);
  assert.equal(matrix.report_count, 3); assert.equal(matrix.configuration_count, 3);
  assert.equal(matrix.configurations[2].failed_runs, 1); assert.deepEqual(matrix.configurations[2].checks, []);
  assert.ok(!JSON.stringify(matrix).includes('verified_hosts'));
});
test('matrix rejects diagnostics presented as native runs and conflicting report identities', () => {
  assert.throws(() => compatibilityMatrix([{ ...report, native_tests_executed: false }]));
  assert.throws(() => compatibilityMatrix([{ ...report, bundle_sha256: 'missing' }]));
  assert.throws(() => compatibilityMatrix([{ ...report, check_count: 2 }]));
  assert.throws(() => compatibilityMatrix([report, { ...report, status: 'failed' }]));
});
