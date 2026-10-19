# Contributing

Keep Apple Pages as the native editing backend. No Accessibility/UI automation, clipboard driver, Word conversion backend or private .pages format rewriting. Add native behavior only when the public scripting API exposes it and real synthetic tests prove it.

Use strict MCP schemas, explicit document IDs, JSON data transport, new-path exports/copies, bounded reads/writes, revision guards where applicable and honest partial-failure semantics. Never use real user documents as fixtures or claim native certification from portable tests. Code and contributions use MIT.
