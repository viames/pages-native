import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../plugins/pages-native/src/server-factory.mjs';
import { tools } from '../plugins/pages-native/src/tools.mjs';
async function connect(bridge) { const s = createServer({ bridge, roots: [] }), c = new Client({ name: 'pages-native-contract', version: '1.0.0' }); const [ct, st] = InMemoryTransport.createLinkedPair(); await s.connect(st); await c.connect(ct); return { c, close: async () => { await c.close(); await s.close(); } }; }
test('official MCP client discovers strict schemas, calls tools and receives bounded errors', async () => {
  const calls = [], c = await connect({ exclusive: fn => fn({ call: async (action, args) => { calls.push({ action, args }); return { automation_tested: false }; } }) });
  try {
    const listed = await c.c.listTools(); assert.equal(listed.tools.length, 28); assert.equal(listed.tools.length, tools.length);
    assert.equal(listed.tools.find(t => t.name === 'pages_edit_text').inputSchema.additionalProperties, false);
    assert.equal(listed.tools.find(t => t.name === 'pages_read_text').annotations.readOnlyHint, true);
    const r = await c.c.callTool({ name: 'pages_status', arguments: {} }); assert.equal(r.structuredContent.plugin_version, '0.1.0'); assert.equal(calls[0].args.launch, false);
    const bad = await c.c.callTool({ name: 'pages_status', arguments: { extra: true } }); assert.equal(bad.isError, true);
    const range = await c.c.callTool({ name: 'pages_read_cells', arguments: { document_id: 'd', table: 1, range: 'A1:C1000' } }); assert.equal(range.isError, true); assert.match(range.content[0].text, /CELL_LIMIT/); assert.equal(calls.length, 1);
  } finally { await c.close(); }
});
test('preview returns native metadata and an inline image; attachment failure does not hide native success', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'pages-image-contract-')); let include = true;
  const c = await connect({ exclusive: fn => fn({ call: async (action, args) => { if (include) writeFileSync(args.image_path, Buffer.from('89504e470d0a1a0a', 'hex')); return { image_path: args.image_path, pdf_path: args.path, renderer: 'contract-test-only' }; } }) });
  try {
    const a = await c.c.callTool({ name: 'pages_preview', arguments: { document_id: 'd', path: join(folder, 'one.pdf') } }); assert.equal(a.content[1].type, 'image'); assert.ok(!JSON.stringify(a.structuredContent).includes(a.content[1].data));
    include = false; const b = await c.c.callTool({ name: 'pages_preview', arguments: { document_id: 'd', path: join(folder, 'two.pdf') } }); assert.ok(!b.isError); assert.ok(b.structuredContent.inline_preview_notice);
  } finally { await c.close(); rmSync(folder, { recursive: true, force: true }); }
});
