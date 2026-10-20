import { StdioServerTransport, createServer } from './runtime.mjs';

await createServer().connect(new StdioServerTransport());
