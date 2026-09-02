---
name: figma-implement-design
description: Use when implementing a Figma design in an existing codebase or matching a screen/component to a Figma reference.
---

# Implement a Figma design

Follow `figma-use` for inspection. Start with `get_design_context`, then use `get_screenshot` and targeted `get_metadata` or `get_variable_defs` queries. Use `get_motion_context` for animated nodes. Map the design to the repository's existing primitives before adding code. Match structure first, then tokens, typography, states, motion, and responsive behavior. Verify the implementation against the reference and report any deliberate deviations.
