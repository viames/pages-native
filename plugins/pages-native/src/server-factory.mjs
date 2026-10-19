import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readFileSync } from 'node:fs';
import { PagesBridge } from './bridge.mjs';
import { PagesTools, tools } from './tools.mjs';
const version = JSON.parse(readFileSync(new URL('../plugin.json', import.meta.url), 'utf8')).version;
export function createServer({ bridge = new PagesBridge(), roots } = {}) {
  const server = new McpServer({ name: 'pages-native', version }, { maxToolInputElements: 15000, instructions: 'Use Apple Pages natively on a logged-in Mac. Call pages_status first; use explicit document IDs and 1-based native indices. Read before editing. pages_edit_text and pages_fill_placeholders default to preview: apply the identical request with expected_revision. Text indices refer to returned native characters, not JavaScript UTF-16 offsets. Mutations may partially apply and have no automatic rollback; never automatically retry timeouts or native errors. Native .pages prototypes are copied without saving the source. Existing placeholder tags can be read and filled but Pages 14.5 rejects changing the tags. Strings in cells are literal; formulas require explicit objects. Inspect native text/formula/format post-checks and PDF/PNG previews. Chart series/type/title, tracked changes, comments, paragraph styles and full document layout are not exposed. No Accessibility, clipboard driver or Word-format editing backend. Native acceptance passed on one Mac with Pages 14.5; other versions remain unverified.' });
  const service = new PagesTools(bridge, { roots });
  for (const spec of tools) server.registerTool(spec.name, { description: spec.description, inputSchema: spec.schema, annotations: spec.annotations }, async args => {
    try {
      const result = await service.execute(spec.name, args); if (['status', 'diagnostics'].includes(spec.action)) result.plugin_version = version;
      const content = [{ type: 'text', text: JSON.stringify(result) }];
      if (spec.action === 'preview' && result.image_path) {
        try { const bytes = readFileSync(result.image_path); if (bytes.length <= 10 * 1024 * 1024) content.push({ type: 'image', mimeType: 'image/png', data: bytes.toString('base64') }); else result.inline_preview_notice = 'Image exceeds 10 MiB; inspect the saved PNG.'; }
        catch { result.inline_preview_notice = 'The native operation completed but the PNG could not be attached; inspect its saved path.'; }
        content[0].text = JSON.stringify(result);
      }
      return { content, structuredContent: result };
    } catch (e) { return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code: e.code ?? 'INVALID_ARGUMENT', message: e.message, ...(e.details ? { details: e.details } : {}) } }) }] }; }
  });
  return server;
}
