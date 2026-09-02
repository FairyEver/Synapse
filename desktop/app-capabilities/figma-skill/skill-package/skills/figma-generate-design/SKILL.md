---
name: figma-generate-design
description: Use when turning a product brief or existing code into editable Figma screens, components, or design assets.
---

# Generate Figma design

The local Desktop MCP does not write generated screens or components back to Figma. Use the brief to generate implementation code in the target repository, using `get_design_context`, `get_screenshot`, `get_variable_defs`, and `get_motion_context` when a Figma reference exists. If the user needs editable Figma output, state that this connector cannot perform that operation and ask them to create or edit the file in Figma Desktop.
