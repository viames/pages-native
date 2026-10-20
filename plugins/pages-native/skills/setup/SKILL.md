---
name: setup
description: Set up Pages Native on a Mac and diagnose Apple Pages, Node.js and Automation permissions.
---

# Set up Pages Native

Requires a logged-in macOS desktop, Apple Pages and Node.js 22+. The bundled server has no runtime npm dependency installation. It cannot control a user's Pages from Linux/cloud execution. The Codex plugin requires a local executor; the MCPB supplies the same tools to compatible local MCP hosts.

Run `pages_status` with `launch=true` to check the native app and Automation permission. If denied, ask the user to allow the actual host to control Pages under System Settings > Privacy & Security > Automation. Do not request Accessibility, enable UI scripting or change permissions yourself. After permission changes start a new local task/session if necessary.

The MCP command is `node <installed-plugin>/dist/server.mjs`. Pass paths as separate arguments, preserving spaces and Unicode. Never interpolate document text into shell commands or AppleScript source. `PAGES_NATIVE_ALLOWED_ROOTS` optionally restricts filesystem tool paths; its value is a JSON array of existing absolute directories. This is a plugin path guard, not an operating-system sandbox for Pages itself.

`pages_diagnostics` reports installation and renderer availability on the current host. `pages_compatibility` adds a scripting-dictionary fingerprint and compares local versions with packaged evidence. Neither tool runs native acceptance or certifies another Mac. For repeatable checks and shareable reports on additional configurations, see [compatibility](../../docs/COMPATIBILITY.md).

If a native call times out or reports `OPEN_PENDING`, do not retry. Inspect Pages for partial edits. The cooperative lock is under the system temporary directory, `pages-native-<uid>.lock`; verify no operation is running before removing a stale lock or restarting the server. Never kill Pages or delete a lock merely to make an operation succeed.
