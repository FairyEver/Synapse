# Expose Terminal platform capabilities without object or grant data

`app.terminal.capabilities.get` is readable by a stable local MCP caller without authentication or a Terminal grant. It returns current capability and tool identities, supported, degraded, or unsupported state, permission categories and risk, platform termination matrices, raw encoding limitations, paste, view, attention, and persistence-protection availability, execution isolation and current-OS-user facts, process-resource-isolation status, request, dimension, wait, and quota hard bounds, plus `generatedAt`. It does not advertise v1/v2 negotiation or legacy aliases while Terminal MCP remains in development.

Static facts also appear in MCP tool metadata; runtime and platform facts come from the capability endpoint. Persistence protection exposes only available, unavailable, or degraded state and functional limitations, never keychain or key-material internals.

The response contains no object or session counts, other actors, quota usage, absolute paths, environment values, or cryptographic internals. Agents read capability data when runtime support facts are needed, after reconnecting, or after an unsupported/degraded result; they do not repeat discovery by habit.

`supported` means only that the current packaged platform implementation can provide the contract. Every actual operation still performs its capability-specific permission, validation, revision, lifecycle, and lease checks.
