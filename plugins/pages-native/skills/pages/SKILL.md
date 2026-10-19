---
name: pages
description: Create, read and edit native Apple Pages documents on macOS with Pages Native MCP tools. Use for .pages files or explicit Apple Pages requests, not ChatGPT Pages or Word documents.
---

# Apple Pages, natively

Call `pages_status` first. The first preview passed native acceptance on one Mac running Pages 14.5; other versions are unverified. If the tool reports missing Automation permission, the user grants the host access in macOS Privacy & Security > Automation. No Accessibility permission is needed.

List/open the intended document and use its explicit `document_id`. Read its layout, text target and native indices before editing. Body text exists only in word-processing documents. Page-layout documents use text items or shapes. Document-wide object and table indices are 1-based and can change after deletion/reflow; inspect again rather than reusing stale indices.

For existing rich text use `pages_edit_text`: preview first, inspect the result, then apply the **identical target and operations** with its `expected_revision`. Prefer literal replacements with an expected match count. Range positions use the native character list returned by `pages_read_text`; do not count JavaScript UTF-16 units or split an emoji/combining character. Native insertions inherit insertion formatting; the revision checks text, not concurrent style changes. Edits are not atomic and do not provide rollback.

Use `pages_format_text` for native font faces, point sizes and RGB colors. Bold/italic require the appropriate font face. Paragraph styles, headings, lists, hyperlinks, headers/footers, comments, tracked changes, full page setup and chart series editing are not exposed by this plugin; never simulate these with UI controls or a converted Word file. Built-in/custom templates preserve features already designed in Pages.

List templates and choose an exact native template ID. `pages_from_template` copies an opaque saved `.pages` prototype without saving or changing the source. For existing tagged placeholders, preview `pages_fill_placeholders`; exact duplicate tags require `expected_count`. The collection covers only placeholders exposed by the native document API. Pages 14.5 rejects changing a placeholder's script tag through the native API.

For tables use table-relative A1 ranges, at most 2,000 cells per call. Strings remain literal; use `{formula:"=..."}` or `{date:"ISO timestamp"}` explicitly. Read back formulas, calculated values and formats; format verification does not validate business calculations. Shrinking tables, merging cells and deleting objects can remove data.

Use the native PDF/PNG preview for visual checks. `.pages` remains the editing format; PDF/RTF/EPUB/plain-text/Word outputs are explicit exports only. Backups require a saved document and a new path; `save_first=true` deliberately saves current edits. Close requires an explicit save/discard choice. Native table merges cannot cross header-column/body-column boundaries.

On a native error or timeout, inspect the affected document before deciding a next action. Never automatically repeat a mutation. A timeout quarantines the bridge and retains its lock; restart/remove a stale lock only after verifying Pages is idle.
