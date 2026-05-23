# Knowledge Base Composer Actions Design

## Context

Knowledge Base projects already register a Synapse-owned `/wiki` prompt command. The command supports subcommands such as `/wiki ingest`, `/wiki query`, `/wiki hot`, `/wiki save`, `/wiki lint`, and `/wiki status`. The runtime execution path is reliable: `/wiki ingest` uses deterministic source scanning and SHA-256 hashes before building the ingest prompt.

The current Agent composer slash menu only sees published top-level command names. Because the knowledge-base contribution publishes only `wiki`, the menu shows `/wiki` but not complete invocations such as `/wiki ingest` or `/wiki query`.

Natural-language ingest requests are also not reliable enough as the primary user path. Users should have an explicit Knowledge Base action surface in the composer, while power users should still be able to find complete `/wiki ...` commands through the slash menu.

Relevant current code:

- `desktop/electron/services/knowledge-base/agent-contribution.ts` creates the knowledge-base project contribution.
- `desktop/electron/services/knowledge-base/wiki-command-prompts.ts` builds `/wiki` subcommand outputs.
- `desktop/electron/services/agent-runtime/agent-runtime-service.ts` publishes commands to the renderer.
- `desktop/src/modules/agent/index.tsx` owns command merging, draft state, and submit flow.
- `desktop/src/modules/agent/components/agent-composer.tsx` owns the composer UI and already passes `leadingActions` into the input box.
- `desktop/src/modules/agent/slash-menu.ts` converts published commands to slash menu candidates.

## Goals

- Show a Knowledge Base action button in the Agent composer only for Knowledge Base projects.
- Add complete `/wiki ...` entries to the slash menu for Knowledge Base projects.
- Keep all Knowledge Base actions on the existing `/wiki` command execution path.
- Let explicit actions such as ingest and hot refresh send immediately.
- Let query insert `/wiki query ` and focus the composer so the user can type a question.
- Avoid renderer-side project type checks and avoid writing runnable capability files to the user vault.

## Non-Goals

- Do not implement broad natural-language intent interception in this phase.
- Do not make `/wiki ingest` a separate runtime command with duplicated execution logic.
- Do not change Scheduler or Workflow Agent behavior.
- Do not redesign the Agent composer or slash menu.
- Do not add dependencies or introduce a second UI styling system.
- Do not write `.claude`, `.agents`, `.codex`, plugin commands, hooks, or skills into user Knowledge Base folders.

## Recommended Architecture

Use a small command metadata extension. The main process remains the source of truth for which project-specific actions are available. The renderer only reacts to published metadata.

```text
Knowledge Base contribution
  - publishes executable `/wiki` command
  - publishes UI-visible `/wiki ...` action entries with metadata

AgentRuntimeService.listPublishedCommands
  - returns normal commands plus Knowledge Base action metadata

AgentModule
  - derives slash candidates from published commands
  - derives Knowledge Base composer actions from published command metadata

AgentComposer
  - renders a left-side Knowledge Base dropdown when actions exist
  - sends or inserts the selected action text

Command router
  - continues parsing `/wiki ingest` as `/wiki` + args
  - continues using buildKnowledgeBaseCommandOutput
```

This keeps the UI discoverable without changing the command execution model.

## Command Metadata

Extend `PublishedAgentCommand` and the renderer mirror type with optional UI metadata:

```ts
interface PublishedAgentCommand {
  readonly name: string
  readonly description?: string
  readonly source: PublishedCommandSource
  readonly kind: PublishedCommandKind
  readonly adminOnly: boolean
  readonly allowedPlatforms?: readonly string[]
  readonly ui?: PublishedAgentCommandUi
}

interface PublishedAgentCommandUi {
  readonly group?: "knowledge-base"
  readonly label?: string
  readonly action?: "send" | "insert"
  readonly insertText?: string
}
```

The `ui` field is intentionally optional and generic. Existing commands do not need to opt in. The first supported group is `knowledge-base`.

Knowledge Base projects should publish these UI entries:

| Name | Label | Action | Insert text |
| --- | --- | --- | --- |
| `wiki ingest` | `汲取来源` | `send` | `/wiki ingest` |
| `wiki query` | `查询知识库` | `insert` | `/wiki query ` |
| `wiki hot` | `刷新热点` | `send` | `/wiki hot` |
| `wiki save` | `保存记录` | `send` | `/wiki save` |
| `wiki lint` | `检查知识库` | `send` | `/wiki lint` |
| `wiki status` | `查看状态` | `send` | `/wiki status` |

The existing top-level `wiki` command may remain published for manual use and backward compatibility. It does not need composer action metadata.

## Runtime Behavior

`createKnowledgeBaseAgentContribution` should continue returning the real registered prompt command named `wiki`. It should also provide the UI-visible command entries through a contribution field such as `publishedCommands`.

`mergeAgentProjectContributions` should combine these published entries across project contributions. `AgentRuntimeService.listPublishedCommands` should include them alongside builtin, registered, custom, skill, and agent-native commands.

The action entries should not add new execution handlers. They are only published command list items. When the user sends `/wiki ingest`, the existing command parser still resolves the command name as `wiki` and passes `["ingest"]` to the existing builder.

## Composer UX

The composer should render the Knowledge Base button in `leadingActions` when at least one published command has `ui.group === "knowledge-base"`.

The button should use the existing shadcn/Radix baseline, preferably `Button`, `DropdownMenu`, and lucide icons. The visual treatment should be compact and neutral. UI text should be limited to the action labels.

Action behavior:

- `send`: call a dedicated composer callback such as `onSendCommand(commandText)`.
- `insert`: call a dedicated callback such as `onInsertText(insertText)` and focus the textarea.

`AgentModule` should own actual draft and submit effects. `AgentComposer` should remain a UI component that calls callbacks.

For `send`, use the same send path as a normal submitted draft but with the command text supplied by the action. It should respect the current active project and sending/disabled state. It should not overwrite the visible draft unless the existing submit path already clears it after sending.

For `insert`, insert `/wiki query ` at the current cursor position and place the cursor after the inserted text. If the draft is non-empty and the cursor is not at a whitespace boundary, add a single separating space before the inserted command. Do not discard existing draft text.

## Slash Menu UX

`toAgentSlashCandidates` should support command names containing spaces. A published command named `wiki ingest` should render as `/wiki ingest`.

Selecting a slash menu candidate remains insert-only. This preserves the existing slash menu design:

- selecting `/wiki ingest` inserts `/wiki ingest`
- selecting `/wiki hot` inserts `/wiki hot`
- selecting `/wiki query` inserts `/wiki query ` if `insertText` is present

The slash menu should not auto-send commands. The explicit Knowledge Base dropdown is the direct-send surface.

Filtering should continue matching by normalized name and description. Typing `/wiki` should show `/wiki`, `/wiki ingest`, `/wiki query`, `/wiki hot`, `/wiki save`, `/wiki lint`, and `/wiki status` for Knowledge Base projects.

## Isolation Rules

- Ordinary projects do not receive Knowledge Base UI entries because `createKnowledgeBaseAgentContribution` returns `null`.
- Scheduler and Workflow should not receive a new shortcut path. They may send `/wiki ...` only if they already target a Knowledge Base Agent runtime and intentionally provide that text.
- The user vault remains data-only. No composer action or slash menu resource is written into the vault.
- The renderer does not scan `.synapse-kb.json` or inspect the project path to decide whether to show the button.
- The SDK plugin can remain as a supplemental model capability, but it is not the source of truth for composer actions.

## Error Handling

If command metadata is missing, the button simply does not render.

If a `send` action is selected while there is no active project or the composer is disabled, the action should be disabled.

If an action has invalid metadata, ignore that action in the renderer. Do not show a broken menu item.

If `/wiki ingest` finds no changed sources, keep the existing command result behavior from `buildKnowledgeBaseCommandOutput`. The composer should not special-case that state.

## Visual and Copy Rules

Follow the current shadcn/Radix baseline:

- Use existing `desktop/src/components/ui/` components.
- Use token classes such as `bg-card`, `bg-popover`, `text-foreground`, `text-muted-foreground`, and `border-border`.
- Do not use custom colors, arbitrary color values, gradients, decorative shadows, or emoji.
- Do not add explanatory product copy in the composer.
- Keep menu labels short action names.

## Testing Strategy

Main process tests:

- Ordinary projects publish no Knowledge Base UI entries.
- Knowledge Base projects publish the real `wiki` command and the UI-visible `wiki ingest`, `wiki query`, `wiki hot`, `wiki save`, `wiki lint`, and `wiki status` entries.
- UI-visible entries include `ui.group === "knowledge-base"` and the expected `action` values.
- Sending `/wiki ingest` still routes through the existing `/wiki` builder and includes deterministic ingest prompt details when sources changed.

Renderer utility tests:

- `toAgentSlashCandidates` preserves names with spaces.
- `replaceAgentSlashFragment` can insert `/wiki ingest`.
- `/wiki query` uses `insertText` with a trailing space when available.
- Knowledge Base actions are derived only from `ui.group === "knowledge-base"` metadata.

Renderer component tests:

- `AgentComposer` does not render the Knowledge Base button when no Knowledge Base actions exist.
- `AgentComposer` renders the Knowledge Base button when actions exist.
- Selecting `汲取来源` calls the direct-send callback with `/wiki ingest`.
- Selecting `刷新热点` calls the direct-send callback with `/wiki hot`.
- Selecting `查询知识库` updates the draft to `/wiki query ` and focuses the textarea.
- Slash menu selection of `/wiki ingest` inserts text without sending.

Regression tests:

- Existing slash menu Enter/Tab/Escape behavior remains unchanged.
- Normal Enter submit still works when the slash menu is closed.
- Existing Knowledge Base command prompt tests continue to pass.

## Implementation Boundaries

Expected main-process changes:

- `desktop/electron/services/agent-runtime/project-contributions.ts`
- `desktop/electron/services/agent-runtime/agent-runtime-service.ts`
- `desktop/electron/services/knowledge-base/agent-contribution.ts`
- main-process tests near existing agent-runtime and knowledge-base contribution tests

Expected renderer changes:

- `desktop/src/types/agent.ts`
- `desktop/src/modules/agent/slash-menu.ts`
- `desktop/src/modules/agent/index.tsx`
- `desktop/src/modules/agent/components/agent-composer.tsx`
- a small Knowledge Base composer action menu component if it keeps `AgentComposer` readable
- renderer tests near existing slash menu and composer tests

Avoid changing:

- `wiki-command-prompts.ts` execution semantics
- `source-scan.ts`
- Scheduler and Workflow modules
- Knowledge Base vault templates
- SDK plugin resources

## Decisions

The product decisions are settled:

- Use a Knowledge Base composer button plus slash subcommand candidates.
- Show the button only when Knowledge Base metadata is published.
- Direct actions send immediately.
- Query inserts `/wiki query ` and focuses the composer.
- Slash menu selections only insert, never send.
- All execution stays on the existing `/wiki` command path.
