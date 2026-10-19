# Pages Native

Native Apple Pages documents for Codex and MCP. **Author: Viames Marino · MIT.**

**Version 0.1.0 is a preview.** Native acceptance passed on one Mac running Pages 14.5 and macOS 27.0.1. This does not establish compatibility across other Pages or macOS versions. See [verification](docs/VERIFICATION.md).

Pages Native uses Apple's scripting API through fixed JXA and AppleScript workers. Documents remain `.pages`: no Word conversion, private-format parser, clipboard driver, Accessibility or UI automation.

## Capabilities

28 MCP tools cover native documents and templates, rich text, existing tagged placeholders, tables with formulas, text/shape/image objects, existing object geometry, explicit native exports, opaque backups and PDF/PNG previews. Existing-text edits and placeholder fills have preview/apply revision guards. Mutations may partially apply; there is no automatic rollback. Pages 14.5 exposes placeholder tags for reading but rejects changing them through its scripting API.

![A native Pages report produced by the acceptance test](docs/assets/demo.png)

The synthetic example shows a native table total of 265 EUR and a separately positioned text item.

The native API does not expose complete paragraph styles, headings/lists, comments, tracked changes, hyperlinks, headers/footers, page setup or chart series/type/title. Features already present in a saved prototype can be preserved through opaque native copies. Creating and editing chart data is not claimed.

## Requirements and installation

- macOS with an interactive, logged-in session and Apple Pages.
- Node.js 22 or later and Automation permission for the actual host controlling Pages.
- Local execution. This cannot run against the user's Mac from a cloud-only task.

Install the public Codex plugin marketplace and enable Pages Native:

```sh
codex plugin marketplace add viames/pages-native
codex plugin add pages-native@viames-pages
```

Start a new local Codex task and run the setup skill. A compatible MCP host can run `node /absolute/path/to/plugins/pages-native/dist/server.mjs`; runtime npm installation is unnecessary after build.

Optional `PAGES_NATIVE_ALLOWED_ROOTS` is a JSON array of existing directories. It guards plugin file paths; it is not a macOS sandbox for the Pages process.

## Development

```sh
npm ci
npm test
npm run build
npm run test:bundle
npm run test:native
npm run package
```

Portable tests validate protocol, bounds, path restrictions, revision planning and timeout recovery. `test:native` controls Pages on an explicitly designated Mac using isolated synthetic documents; ordinary CI does not certify a graphical Pages installation.

See [capabilities](docs/CAPABILITIES.md), [verification](docs/VERIFICATION.md), [publishing](docs/PUBLISHING.md) and [privacy](docs/PRIVACY.md).
