---
name: figma-create-design-system-rules
description: Use when extracting Figma design-system guidance into durable project rules for future implementation work.
---

# Create design-system rules

Use the server prompt `create_design_system_rules` when the MCP client exposes prompts. Otherwise inspect representative nodes with `get_design_context`, `get_metadata`, `get_variable_defs`, and `get_screenshot`. Record only verified conventions: tokens, typography, spacing, component usage, states, motion, and asset rules. The Desktop MCP does not expose library browsing or design-system search tools; do not imply that it does. Write rules only to the repository's existing guidance location and follow its documentation constraints.
