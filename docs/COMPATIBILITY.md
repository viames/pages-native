# Native compatibility checks

Pages Native requires a logged-in macOS session, Node.js 22+, Apple Pages and Automation permission for the actual MCP host. A portable CI pass does not exercise Pages. `pages_compatibility` reads local diagnostics, fingerprints the installed scripting dictionary and compares version information with the packaged evidence. It never marks the current Mac as certified.

The [recorded matrix](compatibility-matrix.json) contains one tested configuration. Native opening uses a resolved file alias and the public AppleScript [application-response control](https://developer.apple.com/library/archive/documentation/AppleScript/Conceptual/AppleScriptLangGuide/reference/ASLR_control_statements.html), then confirms the canonical file path and document ID. It sends no repeated open events; an unconfirmed result quarantines the bridge.

To contribute evidence for another Pages/macOS configuration, clone this repository and run these commands on the Mac you intend to test:

```sh
npm ci
npm run build
node scripts/native-smoke.mjs plugins/pages-native/dist/server.mjs /tmp/pages-native-private-evidence.json /tmp/pages-native-compatibility.json
```

The test imports the exact bundled runtime and exercises its MCP tools while holding the cooperative native lock for the entire suite. Stdio discovery is checked separately with `npm run test:bundle`. It creates isolated synthetic native documents and closes only the IDs it created. Keep other Pages automation idle during the run: a concurrent MCP server is correctly rejected by the lock. Optional `PAGES_NATIVE_WAIT_SECONDS=120` waits only for initial lock acquisition (maximum 600 seconds); it never retries a mutation. Inspect the locally saved PDF/PNG listed in the private evidence file. The shareable compatibility report contains version information, code fingerprints and generic check names; it excludes document contents, fixture paths and machine identifiers. No report is uploaded automatically.

Combine explicit reports from different test runs with:

```sh
node scripts/compatibility-matrix.mjs /tmp/pages-native-compatibility.json other-report.json
```

The matrix separates exact plugin bundles, native workers, test harnesses and Pages/macOS/Node versions. Identical report IDs are deduplicated; failed runs do not add passed checks. Different reports or configurations do not prove different physical Macs. Reports are supplied evidence, not signed certification, and a successful run does not guarantee every tool combination.

For existing chart geometry, use a disposable copy of a native document containing a chart, inspect it with `pages_objects`, then preview/apply position or dimensions with `pages_object`. Inspect the native PDF preview afterwards. Series, data, type and title are not exposed, so a geometry test does not certify chart-data editing.
