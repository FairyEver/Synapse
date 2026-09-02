---
name: figma-generate-library
description: Use when creating or extending a Figma component or design-token library from an approved system.
---

# Generate a Figma library

The local Desktop MCP does not expose library browsing or Figma write tools. Inspect an opened reference with `get_design_context`, `get_metadata`, `get_variable_defs`, and `get_screenshot`, then generate the corresponding component and token code in the target repository. Use the `create_design_system_rules` prompt when available to capture verified conventions. Do not claim that a Figma library was created or changed from Synapse.
