# Contributing

Keep Apple Pages as the native editing backend. No Accessibility/UI automation, clipboard driver, Word conversion backend or private .pages format rewriting. Add native behavior only when the public scripting API exposes it and real synthetic tests prove it.

Use strict MCP schemas, explicit document IDs, JSON data transport, new-path exports/copies, bounded reads/writes, revision guards where applicable and honest partial-failure semantics. Never use real user documents as fixtures or claim native certification from portable tests. Code and contributions use MIT.

Changes to native mutations need a preview with no side effects, revision invalidation for changed native state and an immediate worker precondition check. See [native compatibility reports](docs/COMPATIBILITY.md) for the isolated acceptance suite and configuration matrix. Publishing a report is separate from running it; reports are never uploaded automatically.
