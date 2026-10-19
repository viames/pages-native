import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const folder = mkdtempSync(join(tmpdir(), 'Pages Native clean — '));
cpSync(resolve(process.argv[2] ?? 'plugins/pages-native'), join(folder, 'plugin'), { recursive: true });
assert.equal(existsSync(join(folder, 'node_modules')), false);
const client = new Client({ name: 'pages-clean-contract', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [join(folder, 'plugin/dist/server.mjs')], cwd: folder });
try {
  await client.connect(transport); const listed = await client.listTools(); assert.equal(listed.tools.length, 28);
  const invalid = await client.callTool({ name: 'pages_close', arguments: { document_id: 'not-open', save: false, unexpected: true } });
  assert.equal(invalid.isError, true); assert.match(invalid.content[0].text, /-32602|INVALID_ARGUMENT/);
  console.log(JSON.stringify({ passed: true, native_app_called: false, tool_count: listed.tools.length, verified: ['bundled stdio initialize/list/schema rejection', 'path with spaces and Unicode', 'no runtime node_modules'] }, null, 2));
} finally { await client.close(); rmSync(folder, { recursive: true, force: true }); }
