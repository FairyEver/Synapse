---
name: figma-code-connect
description: Use when mapping published Figma components to code components with Code Connect.
---

# Figma Code Connect

The Desktop MCP does not expose Code Connect read/write tools. Use the server prompt `map_selection_to_code_connect` when the MCP client exposes prompts; it requires `source` and `componentName`, with optional `nodeId`. Use `get_design_context`, `get_metadata`, and `get_screenshot` to inspect the selected component and then create the mapping proposal in the codebase or review it with the user. Do not claim that the mapping was published from Synapse.
