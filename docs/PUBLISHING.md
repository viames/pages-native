# Publishing

Author: Viames Marino. License: MIT. Product: Pages Native 0.1.0 preview.

**Preview 0.1.0 is published and installed locally.** Native acceptance passed on one Mac running Pages 14.5. The source evidence is in `native-verification.json` and the test scope in [verification](VERIFICATION.md).

Publication status as of 2026-10-19:

| Channel | Status |
| --- | --- |
| [GitHub repository](https://github.com/viames/pages-native) | Public; `v0.1.0` release with checksummed plugin ZIP, marketplace ZIP, MCPB, and registry metadata. Fresh downloads and SHA-256 checks passed. |
| [Project site](https://viames.github.io/pages-native/) | Public GitHub Pages site with preview and release links. |
| [Official MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.viames%2Fpages-native/versions/0.1.0) | Version `0.1.0` active. |
| [MCP Servers](https://mcpservers.org/submit) | Free submission accepted; review within 2 weeks. A public listing is pending. |
| [MCP Market](https://mcpmarket.com/submit) | Free queue accepted; site estimated 4–6 weeks. A public listing is pending. |
| [Glama](https://glama.ai/mcp/servers) | Submitted for source-server review; the form closed without a durable receipt or public listing. Its later Docker verification may be incompatible with this macOS/Pages-dependent server. |

The plugin is installed and enabled in Codex as `pages-native@viames-pages` at version `0.1.0`. Open a new local Codex chat after installation so its skills and MCP tools are discovered.

1. Complete native acceptance and inspect real PDF/PNG output using isolated synthetic fixtures. Record actual evidence and limits. Done for the first release on one Mac.
2. Run portable tests, build, skill/manifest/schema validation and deterministic packaging. Test a clean extracted distributable without runtime npm dependencies.
3. Review public content for private paths/data, preserve MIT/dependency notices, then create the public GitHub repository, commit/push, check CI and publish an immutable preview tag and checksummed assets.
4. Verify a fresh public download and installation. Publish the official MCP Registry entry with GitHub OIDC only after the release assets are verified.
5. Use only the already agreed free channels: MCP Servers, MCP Market, and Glama if its workflow succeeds without payment. A submission/review queue is distinct from a live listing. Do not repeat unknown-outcome submissions blindly.

Do not pursue the OpenAI store, request a credit card, purchase premium placement, create cloud hosting for this local-only plugin or search additional marketplaces. Smithery's last Numbers Native publishing attempt returned HTTP 403 and said server updates were removed; re-use of that channel needs a concrete supported local publishing path, not repeated failed uploads. MCP.so was excluded because its live form required a payment.

The release scripts and registry workflow enforce one-host native evidence; they do not establish compatibility on every Mac.
