import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server-factory.mjs';

await createServer().connect(new StdioServerTransport());
