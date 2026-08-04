# Agent Slash Menu Design

## Context

The Agent module already has a top-right command popover, but the new feature is a different interaction: a dedicated slash menu inside the bottom conversation composer. It should help users insert skill and command invocations while writing a message, without sending immediately.

Current relevant code:

- `desktop/src/modules/agent/index.tsx` owns the selected session, command list, draft state, and message submit flow.
- `desktop/src/modules/agent/components/agent-composer.tsx` owns the textarea UI and submit/cancel controls.
- `desktop/electron/services/agent-runtime/command-registry.ts` publishes builtin, custom, file, and registered prompt commands.
- `desktop/electron/services/agent-runtime/skill-registry.ts` publishes discovered skills as slash-callable entries.

The menu must follow the current shadcn/Radix visual baseline and the repository UI rules: no custom colors, no decorative styling, no card nesting, and no product-copy filler.

## Goals

- Open a dedicated Agent composer slash menu when `/` appears anywhere in the textarea.
- Let users select a skill or command and insert it as `/<name>`.
- Replace only the current slash fragment near the cursor, preserving surrounding text.
- Display candidates grouped as `Skills` and `Commands`.
- Use the same current-project plus global command/skill data that the Agent runtime can execute.
- Keep the existing top-right command popover behavior separate.

## Non-Goals

- Do not execute or send the selected item immediately.
- Do not redesign the Agent composer or timeline.
- Do not create a general-purpose command palette.
- Do not add a separate renderer-side scanner for skill or command directories.
- Do not change backend command or skill resolution semantics.

## User Experience

Typing `/` anywhere in the draft opens the menu. The typed slash fragment filters candidates by name.

```text
+------------------------------------------------+
| Please review /rev in this implementation       |
|        ^                                       |
| +------------------------------------------+   |
| | Skills                                   |   |
| |  /review-code  Review code changes       |   |
| | Commands                                 |   |
| |  /status  Show agent status              |   |
| |  /model  Switch model                    |   |
| +------------------------------------------+   |
|                                      [send]    |
+------------------------------------------------+
```

Selection replaces the active fragment:

```text
before: Please review /rev in this implementation
after:  Please review /review-code in this implementation
```

The menu can close through `Esc`, clicking outside, selecting an item, or moving the cursor so there is no active slash fragment. Closing the menu does not mutate the draft.

## Interaction Rules

- `/` at any textarea position can trigger the menu.
- The active fragment is the slash-prefixed token around the cursor, not every slash in the draft.
- Fragment replacement preserves text before and after the fragment.
- `ArrowDown` and `ArrowUp` move the highlighted item.
- `Enter` selects the highlighted item while the menu is open.
- `Tab` selects the highlighted item while the menu is open.
- `Esc` closes the menu.
- Normal `Enter` submission continues to work when the menu is closed.
- IME composition must keep the existing submit protection and must not select menu items while composing.
- Clicking an item selects it and returns focus to the textarea.

## Architecture

```text
AgentModule
  - derives slash candidates from the selected agent definition and runtime commands
  - passes candidates to AgentComposer

AgentComposer
  - owns textarea refs and draft editing
  - computes active slash fragment from draft and selection
  - handles keyboard routing between menu selection and message submit
  - renders AgentSlashMenu next to the composer

AgentSlashMenu
  - renders grouped candidates
  - owns highlight movement for visible items
  - calls onSelect(candidate) only; it does not know about sending messages

slash-menu utilities
  - detect active fragment
  - filter and group candidates
  - replace fragment with selected invocation
```

## Candidate Model

The renderer should continue using the Agent module's published command list rather than reading files itself. This keeps the menu aligned with runtime execution.

Candidate fields:

- `name`: normalized command or skill name without leading `/`
- `description`: optional short description from the published entry
- `kind`: `skill` or `command`
- `source`: original published source for diagnostics and stable grouping

Grouping:

- `kind === "skill"` appears under `Skills`
- all other published command entries appear under `Commands`

De-duplication should follow the existing `mergedCommands` behavior in `AgentModule`: first entry by name wins after combining selected agent definition commands and runtime commands.

## Files

- `desktop/src/modules/agent/slash-menu.ts`
- `desktop/src/modules/agent/components/agent-slash-menu.tsx`
- `desktop/src/modules/agent/components/agent-composer.tsx`
- `desktop/src/modules/agent/index.tsx`
- `desktop/src/modules/agent/__tests__/slash-menu.test.ts`
- `desktop/src/modules/agent/__tests__/agent-slash-menu.test.tsx`
- `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`

## Visual Rules

Use the existing component baseline and token classes:

- Prefer shadcn/Radix primitives already in `desktop/src/components/ui/`.
- Use neutral token classes such as `bg-popover`, `text-popover-foreground`, `border-border`, `text-muted-foreground`, and `bg-muted`.
- Keep each candidate on one compact line, place the description after the name, and truncate overflow with an ellipsis.
- Keep class names short and layout-oriented.
- Do not use hex, rgb, hsl, arbitrary color values, gradients, decorative shadows, or emoji.
- Keep UI text to group labels, names, descriptions, and a short empty state if needed.

## Error Handling

This is primarily renderer UI state. If candidates are unavailable, show no menu or an empty state. Do not log noisy warnings for normal empty lists.

Unexpected selection or fragment replacement failures should be prevented by utility function types. If a handler receives an impossible state at runtime, close the menu and leave the draft unchanged.

## Testing

Unit tests for `slash-menu.ts`:

- detects slash fragments at any draft position
- returns no active fragment when the cursor is outside a slash token
- replaces only the active fragment
- preserves surrounding text
- filters by typed fragment
- groups skills before commands

Component tests:

- typing `/rev` opens the menu and filters items
- `Enter` selects while the menu is open and does not submit
- `Tab` selects while the menu is open
- `Esc` closes without changing the draft
- normal `Enter` still submits when the menu is closed
- click selection inserts `/<name>`
- rendered groups include `Skills` and `Commands` when both are present

## Decisions

All user-facing behavior needed for implementation is decided:

- trigger anywhere in the input
- insert `/<name>`
- replace the current slash fragment
- use current project plus global published runtime entries
- display `Skills` and `Commands` groups
