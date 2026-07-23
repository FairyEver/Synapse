# Use Terminal permission categories without local grants

Terminal capabilities keep separate permission categories for discovery, state, metadata, output, command launch, session creation, control, resize, termination, management, and deletion. These categories describe capability intent, risk, permission-guard checks, and audit events. They prevent one tool or mode switch from silently combining unrelated operations.

The loopback HTTP MCP uses the existing local MCP user actor, so it does not require Terminal-specific grants, resource predicates, roles, presets, expiry, or a secondary authorization UI. The Agent remains bound by the user's request, immutable object ids, revisions, lifecycle checks, deletion plans, and input leases. A future remote transport may define a separate authorization design, but it must not add grant requirements to the local MCP path.
