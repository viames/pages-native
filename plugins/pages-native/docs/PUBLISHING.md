# Publishing

Author: Viames Marino. License: MIT. Product: Pages Native. Release: **0.5.0**.

Version 0.5 passed **76 native checks on one Mac** and **70 portable tests** separately. New features include structured search, typed table fields, guided templates, reusable local recipes, sequential batch generation and retained recipe/model history. Evidence and boundaries are recorded in [verification](VERIFICATION.md) and `native-verification.json`; no other Pages/macOS configuration is certified.

## Distribution channels

| Channel | Distribution and update path |
| --- | --- |
| [GitHub repository](https://github.com/viames/pages-native) | Public source and [v0.5.0 release](https://github.com/viames/pages-native/releases/tag/v0.5.0) with plugin ZIP, marketplace ZIP, MCPB, registry metadata and SHA-256 checksums. |
| [Project site](https://viames.github.io/pages-native/) | GitHub Pages serves `main/docs`; release and verification links identify 0.5.0. |
| [Official MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.viames%2Fpages-native/versions/0.5.0) | The release workflow verifies the public MCPB and metadata, then publishes the versioned entry with short-lived GitHub OIDC. Check the workflow and live registry response for completion. |
| [MCP Servers](https://mcpservers.org/servers/viames/pages-native) | Public listing verified on 20 October 2026. README refresh requested; directory caches may lag the repository. |
| [Glama](https://glama.ai/mcp/servers/viames/pages-native) | Public source listing verified on 20 October 2026. Repository synchronization updates the indexed README. The local-only Pages server cannot be deployed in Glama's cloud. |
| [MCP Market](https://mcpmarket.com/submit) | Free submission accepted previously; review queue estimated 4–6 weeks. No matching public listing was found on 20 October 2026. Do not submit a duplicate or pay to accelerate review. |

The locally installed Codex plugin is `pages-native@viames-pages`. The public marketplace reads the repository. After installing or updating, start a new local Codex chat so the new skills and tools are discovered. Earlier local cache versions are preserved for existing chats.

## Release procedure

1. Complete native acceptance using isolated synthetic fixtures and inspect the real PDF/PNG previews. Record the exact runtime, worker and harness fingerprints and one-host limits.
2. Run portable tests, skill/manifest/schema validation and deterministic packaging. Test a clean distributable without runtime npm dependencies and the actual installed MCP stdio server.
3. Review public files for private data/paths, preserve MIT and dependency notices, commit/push the scoped source, verify portable CI, and create a new immutable version tag with checksummed release assets. Never reuse an existing tag.
4. Verify fresh public downloads, checksums and clean initialization. Only then dispatch the official MCP Registry workflow for that tag and verify the live versioned entry.
5. Update the existing free directory listings. Distinguish a live listing, a cached old README, an accepted update request and a pending review queue.

Do not pursue the OpenAI store, request a credit card, purchase premium placement, create cloud hosting for this macOS-only plugin or search additional marketplaces. Smithery's last Numbers Native publishing attempt returned HTTP 403 and said server updates were removed; it needs a concrete supported local publishing path rather than repeated failed uploads. MCP.so was excluded because its live form required payment.

A release upload or listing does not establish native compatibility on every Mac. Named paragraph styles, comments, tracked changes and chart series/type/title remain outside the public scripting API used here.
