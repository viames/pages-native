# Verification

## Native acceptance — 19 October 2026

**Passed on one Mac:** macOS 27.0.1 (Darwin 27.0.0), Pages 14.5, Node.js 24.19.0. The native harness performed **34 checks** against new synthetic `.pages` fixtures in a private temporary directory. It closed only the document IDs it created. The exported PDFKit PNG preview was inspected visually: the edited heading, expense table, calculated 265 EUR total and text item were present.

The checks cover native Automation and template discovery; document create/save/close/reopen; body, section, page and page-layout text targets; Unicode character boundaries; font/size preservation around edits; preview and stale-revision guards; existing placeholder discovery and guarded filling; table formulas, literal strings, currency, dimensions, sort, merge/unmerge and resize/delete; text item, shape and image creation and image geometry; facing pages; opaque custom prototypes and backups; and native PDF, TXT, RTF, DOCX and EPUB exports.

Two real Pages behaviors changed the implementation. Assigning a string to a range of characters broadcasts it to every character; Pages Native now edits individual native characters in reverse order and checks the resulting text. Pages 14.5 rejects writes to placeholder script tags (`-10000`) despite exposing the property in its scripting dictionary. The unsupported tag-write tool was removed; filling placeholders with existing tags uses the native AppleScript command. Pages also rejects merges that cross a header-column/body-column boundary.

This is **one-host acceptance**, not universal certification. Other Pages/macOS releases and existing-chart geometry on a user-supplied document remain unverified. The API does not expose chart series/type/title, complete paragraph styles, comments or tracked changes. Native Apple Events are not transactional; inspect a document after any partial-write error or timeout.

## Portable and package checks

Portable tests cover serialization and lock ownership, timeout quarantine, private request-file transport, opaque copies and symlink/path restrictions, Unicode text planning, stale revisions, placeholder duplicate guards, cell-format preflight, strict schemas and MCP client behavior. The clean bundled stdio smoke initializes the server and discovers **28 tools** from a copied plugin without runtime `node_modules`. These tests do not control Pages and are reported separately from native acceptance.

The MCPB and official MCP Registry metadata schemas, plugin skills, deterministic ZIP checksums and fresh public download are release checks. Record their actual results in the release notes; do not treat a successful upload or listing submission as cross-Mac compatibility evidence.
