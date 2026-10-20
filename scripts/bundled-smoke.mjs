import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, existsSync, rmSync, readdirSync, mkdirSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const folder = mkdtempSync(join(tmpdir(), 'Pages Native clean — '));
let client;
function copyTree(source, destination) {
  const entry = lstatSync(source);
  if (entry.isDirectory()) {
    mkdirSync(destination, { recursive: true });
    for (const name of readdirSync(source)) copyTree(join(source, name), join(destination, name));
  } else if (entry.isFile()) copyFileSync(source, destination);
  else throw new Error(`Unexpected plugin entry: ${source}`);
}
try {
  const source = resolve(process.argv[2] ?? 'plugins/pages-native');
  const pluginRoot = join(folder, 'plugin');
  copyTree(source, pluginRoot);
  assert.equal(existsSync(join(pluginRoot, 'node_modules')), false);
  const serverPath = join(pluginRoot, 'dist', 'server.mjs');
  assert.ok(existsSync(serverPath), `Copied server is missing: ${JSON.stringify(readdirSync(pluginRoot))}`);
  client = new Client({ name: 'pages-clean-contract', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath], cwd: folder });
  await client.connect(transport); const listed = await client.listTools(); assert.equal(listed.tools.length, 36);
  const invalid = await client.callTool({ name: 'pages_close', arguments: { document_id: 'not-open', save: false, unexpected: true } });
  assert.equal(invalid.isError, true); assert.match(invalid.content[0].text, /-32602|INVALID_ARGUMENT/);
  console.log(JSON.stringify({ passed: true, native_app_called: false, tool_count: listed.tools.length, verified: ['bundled stdio initialize/list/schema rejection', 'path with spaces and Unicode', 'no runtime node_modules'] }, null, 2));
} finally { if (client) await client.close(); rmSync(folder, { recursive: true, force: true }); }
