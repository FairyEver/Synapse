# Agent Slash Quick Inputs Design

## Context

The Agent composer already has two related input helpers:

- A `/` menu that appears while editing a slash fragment and inserts agent skills or commands.
- A bottom `片段` menu that inserts saved quick inputs, or sends them directly when `directSend` is enabled.

Users want saved quick inputs to also appear in the `/` menu. The `/` menu should remain an editing aid: selecting a quick input inserts text into the draft and never sends a message.

Relevant existing files:

- `desktop/src/modules/agent/slash-menu.ts`
- `desktop/src/modules/agent/components/agent-slash-menu.tsx`
- `desktop/src/modules/agent/components/agent-composer.tsx`
- `desktop/src/modules/agent/components/quick-input-menu.tsx`
- `desktop/src/modules/agent/index.tsx`
- `desktop/src/types/config.ts`

## Goals

- Show user quick inputs in the Agent composer `/` menu.
- Put quick inputs before `Skills` and `Commands`.
- Select a quick input from the `/` menu to insert its full content into the draft.
- Keep bottom `片段` menu behavior unchanged, including `directSend`.
- Keep runtime slash command routing unchanged.

## Non-Goals

- Do not add quick input titles, categories, search fields, or extra settings.
- Do not register quick inputs as runtime commands.
- Do not change Agent command or skill discovery.
- Do not redesign the composer or settings panel.
- Do not add dependencies.

## User Experience

Typing `/` opens the existing slash menu. The menu groups candidates in this order:

1. `片段`
2. `Skills`
3. `Commands`

Quick input candidates use the first non-empty content line as the visible slash-style name. Choosing the item replaces the active slash fragment with the full quick input content.

Example:

```text
before: /日报
chosen: 片段 /日报模板
after:  <full saved quick input content>
```

If a quick input has `directSend: true`, that flag is ignored inside the `/` menu. Direct send remains available only from the bottom `片段` menu.

## Interaction Rules

- `/` menu selection for quick inputs only inserts text.
- Quick inputs are shown before skills and commands.
- Filtering matches quick input display names and previews through the existing slash candidate filter.
- Empty or invalid quick inputs do not appear.
- Duplicate names are allowed across groups; quick inputs remain visible because they are a separate group.
- Skills and commands keep their current insertion behavior.
- Existing keyboard behavior remains: arrow keys move highlight, `Enter` or `Tab` selects, `Esc` closes.

## Architecture

Treat the slash menu as an input completion menu with three candidate kinds.

```text
config.global.quickInputs
  -> quick input slash candidates

mergedCommands
  -> skill and command slash candidates

AgentModule
  -> combines candidates with quick inputs first
  -> passes all candidates to AgentComposer

AgentComposer
  -> keeps existing fragment detection, filtering, keyboard handling, and insertion

AgentSlashMenu
  -> renders grouped candidates in slash-menu group order
```

Quick inputs stay renderer-local config data. They do not enter Electron runtime command registries, skill registries, command routing, or agent execution.

## Candidate Model

Extend `AgentSlashCandidateKind`:

```ts
export type AgentSlashCandidateKind = "quickInput" | "skill" | "command"
```

Quick input candidates:

- `kind`: `quickInput`
- `name`: first non-empty line of `content`, normalized by trimming and removing leading slashes
- `description`: short preview of the content when useful
- `insertText`: the complete quick input content

The existing `replaceAgentSlashFragment` function can insert quick inputs through `insertText`, so no special composer insertion branch is needed.

## Visual Rules

Follow the current shadcn/Radix baseline:

- Use existing token classes such as `bg-popover`, `text-popover-foreground`, `border-border`, `bg-muted`, and `text-muted-foreground`.
- Use the existing slash menu surface and scroll behavior.
- Use a neutral lucide icon for quick input items if the menu needs a distinct icon.
- Keep UI text to group labels, candidate names, descriptions, and the existing empty state.
- Do not use custom colors, arbitrary Tailwind colors, gradients, decorative shadows, emoji, or card nesting.

## Error Handling

This is renderer-only UI state:

- Invalid quick inputs are filtered out when creating candidates.
- If there are no quick inputs, the menu simply shows skills and commands as it does today.
- If all candidates fail to match the fragment, keep the existing empty menu state.
- Selection should leave the draft unchanged if no active fragment exists.

## Testing

Unit tests for `slash-menu.ts`:

- Converts quick inputs into slash candidates.
- Uses the first non-empty line as the candidate name.
- Preserves full content in `insertText`.
- Groups quick inputs before skills and commands.
- Filters quick inputs by typed fragment.
- Replaces a slash fragment with full quick input content.

Composer tests:

- `/` menu renders `片段` before `Skills` and `Commands`.
- Selecting a quick input inserts content into the draft.
- Selecting a quick input does not call submit or direct-send handlers.
- Existing skill and command selection tests continue to pass.
- Bottom `片段` menu direct-send behavior remains unchanged.

## Implementation Boundaries

Expected files:

- `desktop/src/modules/agent/slash-menu.ts`
- `desktop/src/modules/agent/components/agent-slash-menu.tsx`
- `desktop/src/modules/agent/components/agent-composer.tsx`
- `desktop/src/modules/agent/index.tsx`
- `desktop/src/modules/agent/__tests__/slash-menu.test.ts`
- `desktop/src/modules/agent/__tests__/agent-slash-menu.test.tsx`
- `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`

Avoid changing:

- `desktop/src/types/config.ts`
- settings quick input data model or settings panel behavior
- `desktop/electron/services/agent-runtime/*`
- command registry, skill registry, scheduler, workflow, and knowledge base runtime services

## Decisions

- The `/` menu inserts quick inputs and never sends them.
- The bottom `片段` menu remains the only place where `directSend` matters.
- Quick input candidates appear first.
- No new title field is added; the first non-empty content line is the display name.
- Quick inputs remain config data, not runtime commands.
