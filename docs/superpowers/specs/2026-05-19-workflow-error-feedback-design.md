# Workflow Error Feedback Design

## Context

The workflow editor currently renders validation failures in a top-page alert. Some node configuration errors come from Zod and can surface as raw issue arrays, which reads like leaked JSON instead of product guidance.

This design replaces the top alert as the primary error surface for workflow create/edit save and run validation failures.

## Goals

- Show validation errors as clear, user-facing repair guidance.
- Keep the right configuration panel usable at all times.
- Let users jump from an error to the affected node or field.
- Avoid showing raw schema, JSON, stack, IPC, or implementation details.
- Keep the visual treatment aligned with the current shadcn/Radix baseline.

## Non-Goals

- Redesign the workflow canvas.
- Change workflow validation rules.
- Add a new visual theme or custom color system.
- Change runner-history error rendering.

## UX Model

Validation errors appear in a non-modal floating card inside the canvas area.

- The card appears after save or run validation fails.
- The card is anchored to the canvas, not the window chrome and not the right configuration panel.
- The right configuration panel remains visible and editable.
- The card can be dismissed with a close button.
- After dismissal, a small collapsed entry remains so users can reopen the error list.
- Editing the workflow clears resolved or stale validation state using the existing editor change flow.

## Floating Card

The expanded card contains:

- Title: `需要处理 N 处`
- Up to three visible error rows.
- A compact overflow row when more errors exist.
- A close icon button in the top right.

Each error row contains:

- A short human-readable summary.
- A location label when available, such as node name or edge context.
- A click target that selects the affected node when `nodeId` is present.

The collapsed state contains:

- `N 处需要处理`
- A click action to reopen the card.

The card should use existing shadcn primitives and theme tokens. It must not use inline colors, gradients, custom palette values, or decorative copy.

## Right Panel Behavior

The floating card is the first global entry point. The right panel is the repair surface.

When a user clicks an error with `nodeId`:

- Select that node.
- Keep the right configuration panel visible.
- Show field-level error text when the error can be mapped to a field.
- Keep the global card available unless the user closes it.

When an error cannot be mapped to a field:

- Select the node when possible.
- Show the node-level message in the configuration panel.

When an error only has `edgeId` or is workflow-level:

- Keep it in the floating card.
- Do not invent a field location.

## Error Copy

The UI must not render raw `ZodError.message` when it is an issue array.

Error copy should follow these rules:

- Say what the user needs to fix.
- Mention the affected node or branch when helpful.
- Keep each row to one concise sentence.
- Use technical details only when the user entered them directly, such as a branch id or parameter name.

Examples:

- Raw schema issue for missing `projectId`: `请选择项目，或设置工作流默认项目。`
- Empty prompt: `提示词不能为空。`
- Unconnected switch branch: `分支“兜底”需要连接到下游节点。`
- Missing template variable binding: `模板变量“customer”需要添加变量绑定。`

## Error Normalization

Add a workflow-editor-level presentation mapper that converts `ValidationError[]` into display items.

Each display item should include:

- `id`
- `summary`
- `location`
- `nodeId`
- `edgeId`
- optional `fieldKey`
- original validation `type`

The mapper may use the current `WorkflowDefinition` to resolve node names and branch labels.

For schema-originated messages:

- Prefer structured Zod issues if the validator can provide them.
- If only a string is available, detect JSON-like issue arrays and map known paths to friendly copy.
- Fall back to a generic node configuration message rather than showing raw JSON.

## Implementation Boundaries

- Keep privileged Electron behavior unchanged.
- Keep validation rule semantics unchanged.
- Prefer module-local workflow editor components and utilities under `desktop/src/modules/workflow/`.
- Reuse existing shadcn components from `desktop/src/components/ui/`.
- Do not add dependencies.
- Do not use custom color literals, inline styles, or new CSS modules.

## Testing

Cover the mapper and editor behavior with focused tests.

- Raw Zod issue-array messages are not rendered.
- The floating card shows a count and at most three primary rows.
- Closing the card shows the collapsed entry.
- Clicking a node error selects the node.
- Workflow-level errors remain visible without selecting a node.

## Positioning And Scope

- Anchor the expanded card to the canvas top-right with enough inset to avoid the existing floating toolbar.
- Keep the card width compact so it does not cover the right configuration panel.
- Start field-level mapping with known fields for existing node types.
- Unknown paths fall back to node-level messages.
