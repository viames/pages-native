# Changelog

## 0.5.0 — 20 October 2026

Added `pages_compose_batch` and `pages_recipe_history` (36 tools). Batches preflight all 1–10 records, bind the complete request to a revision, create new outputs sequentially and return per-item outcomes. Stop-on-error is the default; uncertain native state always stops. Successful unmodified outputs can close automatically; failed partial outputs are retained without retries.

Recipe changes now retain definitions and deduplicated opaque saved prototype copies, with committed history pointers, structural comparisons and monotonic revisions across deletion. Historical composition selects an archived model; guarded restore creates a new current revision. Import of pre-0.5 definitions records unavailable old model bytes explicitly. Earlier overwritten/deleted versions cannot be recovered. Recipient values are not persisted. Only public native document APIs are used. Native acceptance passed 76 checks on one Mac; 70 portable tests passed separately. Named paragraph style assignment remains outside the public API.

## 0.4.0 — local development preview

Guided composition now supports explicit native cell bindings with table index/name and A1 identity, typed numbers/dates/formulas, compatible base formats, optional deliberate clearing and native readback. Existing formula results may recalculate while their original formula/styles remain guarded. Cell fields can accompany either literal text or native tags. Native probes showed that Pages coerces boolean cell inputs to 0/1 and reserves checkbox controls for Numbers; both are now rejected before any cell mutation instead of causing partial writes.

Added three local recipe tools (34 tools total): list/read definitions, preview/apply save/delete, and preview/apply new native outputs from stored definitions plus supplied values. Recipes use relative prototype paths, exact saved-byte fingerprints, incrementing versions, revision conflicts and atomic local JSON writes. Last-use values are not persisted; defaults are explicit. No automatic history or upload. Public release remains 0.1.0.

## 0.3.0 — local development preview

Added `pages_search` and `pages_compose` (31 tools). Structured literal search returns context, native-character positions for text and explicit table/cell references; scopes, ranges, case comparison, formula search and bounded pagination are configurable. Guided composition validates required/default/optional fields and exact literal or script-tag occurrence counts, previews the plan and fills only a new opaque saved-prototype copy. Revisions bind source bytes, native field state, recipe and destination. Failed compositions retain their destination for inspection rather than retrying partial native edits. Source documents are never saved or edited.

Public release remains 0.1.0. Native-only API boundaries and one-host compatibility limits remain.

## 0.2.0 — local development preview

Mutation tools for formatting, tables/cells, sorting, merges, dimensions, objects and facing pages now default to preview; applying requires the identical request and expected revision. The native worker rechecks API-visible content/styles/geometry before writes. Source image changes invalidate previews. Added readback for cell styles and individual table dimensions, stricter native scope preflights, and explicit unlock handling.

Added `pages_compatibility` (29 tools total), a shareable native acceptance report with code/environment fingerprints, and a matrix builder that separates tested configurations from diagnostics and portable CI. Multiple Macs and other Pages releases still require actual native test runs. Native acceptance passed 43 checks on one Mac with Pages 14.5; 39 portable tests passed. Open now resolves a native alias, sends one AppleScript open event and verifies the canonical path/ID without forcing pagination. Public release remains 0.1.0.

## 0.1.0 — native preview

Initial native Pages MCP/Codex implementation with 28 tools. Native acceptance passed 34 checks on one Mac with Pages 14.5: guarded text edits, existing placeholders, native tables and formulas, page layouts, objects, exports, previews and opaque prototypes/backups. Removed placeholder tag mutation after Pages rejected it through both public scripting interfaces. See verification and capability boundaries.
