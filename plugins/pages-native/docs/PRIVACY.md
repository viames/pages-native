# Privacy

Pages Native runs locally and has no document-content telemetry or external service calls. Fixed native workers send Apple Events to Pages; macOS Automation permission is required. Native documents remain `.pages`. Request JSON for the AppleScript helper is stored briefly in a private temporary directory and removed after the call.

Tool results may include text, tables, filenames, local paths and preview images. The MCP host/AI service handles those results under its own privacy policy; local operation does not mean the host cannot receive requested document content. Exported PDFs/images and backups are retained at the destinations selected by the caller.

`PAGES_NATIVE_ALLOWED_ROOTS` restricts plugin filesystem paths, not the operating-system capabilities of Pages. Grant only the intended host access. No Accessibility, clipboard access, password collection or automatic permission changes are required.
