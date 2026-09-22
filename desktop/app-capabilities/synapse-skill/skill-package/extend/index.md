# Extensions

## Reaching Synapse tools

Synapse publishes only two tools: `search` and `invoke`. Search for `extend_portal_headless_credential_get` in domain `extend`, then invoke its exact returned name and schema. Business calls use the returned HTTP base URL; they are not MCP tools.

Extensions are peers under the `extend` namespace. They are not Synapse System Apps.

- Portal business requests, meeting room occupancy, personal yearly agreements -> `portal-headless/index.md`.

Discover an extension's local tools through MCP `search` with `domain: "extend"`, then `invoke` the exact returned tool name and schema. Do not invent `app_portal_*` tools.
