# Native capability boundary

The core native workflows below passed real acceptance tests on one Mac running Pages 14.5. Individual tool combinations and other Pages/macOS versions are not exhaustively certified. The installed Pages scripting dictionary is the implementation source; dictionary declarations alone were not treated as proof.

| Area | Implemented surface | Limits |
| --- | --- | --- |
| Documents | Status, diagnostics, list/open/create/save/close/inspect, facing pages | Explicit IDs; close requires a save/discard choice. No layout-mode conversion. |
| Templates | Built-in IDs; opaque custom `.pages` copies | Saved sources only; never save the prototype. Native template IDs can vary. |
| Rich text | Body/section/page/text item/shape read; literal/range edit preview/apply; font/size/color | Native character indices; text revision guard, not style revision guard. New text inherits insertion formatting. No full-body rewrite for existing edits. |
| Placeholders | Native document collection; exact existing-tag preview/apply | Does not claim discovery of hidden/unexposed placeholders. Duplicate tags need counts. Pages 14.5 rejects script-tag changes. |
| Tables | Create/update/delete, cells/formulas/dates, compatible base formats, range styles, sort/merge, dimensions | 2,000 cells per request. Product creation cap 1,000 rows/100 columns, subject to Pages' own limits. No chart-source introspection. |
| Objects | Create text/shape/image; list/update/delete existing exposed objects | Position/dimensions/locking as exposed. Existing rich text edits use the guarded text tool. No chart series/type/title/data creation. |
| Files | New-path opaque backup; native exports; PDF/PNG previews | No overwrites for copies/exports. Backups require saved state. No private `.pages` parsing. |

No Accessibility/System Events, simulated input, private file-format APIs, automatic cloud hosting or document-content telemetry. Comments, tracked changes, hyperlinks, headings/lists, paragraph styles, headers/footers and detailed page/section setup are not implemented.

Text and placeholder guards re-read native content immediately before mutations. They do not make Apple Events transactional. Failed post-checks and timeouts can leave partial edits; inspect rather than retrying automatically. A timed-out bridge is quarantined and retains its cooperative lock. Merge cannot cross a header-column/body-column boundary in Pages; inspect the table's header counts before choosing a range.
