# Knowledge Base Slash Catalog Design

## Context

The Agent composer already has two Knowledge Base entry points:

- The bottom `知识库` menu, which exposes a few quick actions.
- The `/` menu, which inserts slash candidates while the user edits a draft.

The current Knowledge Base quick list is incomplete. It is a renderer-side static list of common items, while the managed Knowledge Base runtime template contains a larger command and skill set. This creates drift: users see only a subset in the UI even though the managed project can support more slash commands.

Relevant files:

- `desktop/src/modules/agent/knowledge-base-commands.ts`
- `desktop/src/modules/agent/slash-menu.ts`
- `desktop/src/modules/agent/components/agent-slash-menu.tsx`
- `desktop/src/modules/agent/components/knowledge-base-action-menu.tsx`
- `desktop/src/modules/agent/index.tsx`
- `desktop/electron/services/agent-runtime/index.ts`
- `desktop/resources/knowledge-base/claude-obsidian-template/commands/`
- `desktop/resources/knowledge-base/claude-obsidian-template/skills/`

## Goals

- Show a complete Knowledge Base command group in the existing Agent `/` menu.
- Use the group label `知识库`.
- Render each Knowledge Base slash candidate with the command followed by its Chinese description on one compact line.
- Keep the bottom `知识库` quick menu as a curated subset.
- Drive both surfaces from one Knowledge Base capability catalog.
- Show Knowledge Base entries only for managed Knowledge Base projects.
- Keep `/` menu selection insert-only.

## Non-Goals

- Do not redesign the Agent composer.
- Do not make `/` menu selections send messages.
- Do not show every Knowledge Base capability in the bottom quick menu.
- Do not scan renderer-side filesystem paths at runtime.
- Do not write commands, skills, hooks, or plugin files into user-visible project folders.
- Do not change Scheduler or Workflow behavior.

## Product Model

The two UI surfaces have different jobs:

```text
/ menu
  = complete catalog
  = discovery and insertion
  = all Knowledge Base slash-capable entries

bottom Knowledge Base menu
  = curated shortcuts
  = common high-value actions
  = send or insert depending on action metadata
```

The `/` menu should group candidates in this order when a managed Knowledge Base project is selected:

```text
片段
知识库
Skills
Commands
```

If no quick inputs exist, `片段` is omitted as it is today. If the selected project is not a managed Knowledge Base, `知识库` is omitted.

## Knowledge Base Catalog

Create one renderer catalog for Knowledge Base Agent UI capabilities in `desktop/src/modules/agent/knowledge-base-commands.ts`. Each item represents a slash-callable command or skill from the managed runtime template.

Catalog shape:

```ts
type KnowledgeBaseAgentCapability = {
  readonly name: string
  readonly description: string
  readonly slashText?: string
  readonly quickAction?: {
    readonly label: string
    readonly action: "send" | "insert"
    readonly insertText?: string
  }
}
```

Rules:

- `name` is stored without the leading slash.
- `slashText` defaults to `/${name}`.
- `description` is a short Chinese user-facing description shown after the command in the `/` menu.
- `quickAction` means the item appears in the bottom `知识库` menu.
- Items without `quickAction` appear only in the `/` menu.

Initial full catalog:

| Name | Description |
| --- | --- |
| `autoresearch` | 围绕主题研究并写入知识库 |
| `canvas` | 创建或更新知识库画布 |
| `defuddle` | 清理网页正文后用于入库 |
| `obsidian-bases` | 创建或编辑 Obsidian Bases |
| `obsidian-markdown` | 按 Obsidian 语法编写页面 |
| `save` | 保存当前对话或关键结论 |
| `wiki` | 管理知识库结构与热缓存 |
| `wiki-fold` | 折叠整理知识库日志 |
| `wiki-ingest` | 汲取资料，整理 .raw 中的新内容 |
| `wiki-lint` | 检查链接、索引、孤立页面和结构问题 |
| `wiki-query` | 查询知识库并基于已有页面回答 |

Initial quick subset:

```text
wiki-ingest
wiki-query
save
autoresearch
wiki-lint
```

`canvas` can remain discoverable in `/` but not part of the initial quick subset unless product usage shows it is common enough.

## Slash Menu Rendering

Extend the slash candidate model with a Knowledge Base kind:

```ts
type AgentSlashCandidateKind = "quickInput" | "knowledgeBase" | "skill" | "command"
```

The `/` menu should render Knowledge Base candidates on one compact line. Descriptions use the remaining width and truncate with an ellipsis when necessary:

```text
/wiki-ingest  汲取资料，整理 .raw 中的新内容
/wiki-query   查询知识库并基于已有页面回答
```

Use the existing neutral menu surface and token classes. The change should only add the group and candidate data; it should not add custom colors, gradients, or a new visual system.

Selection behavior:

- Selecting a Knowledge Base candidate replaces the active slash fragment with `slashText`.
- It does not submit the message.
- If `slashText` ends with a space, the cursor lands after that space.

## Quick Menu Rendering

The bottom `知识库` menu should derive actions from the same catalog:

```text
catalog
  -> filter quickAction exists
  -> KnowledgeBaseComposerAction[]
```

This preserves the current product split:

- `send` actions send immediately through the existing Agent submit path.
- `insert` actions insert text and focus the composer.
- The menu label stays `知识库`.
- Only curated actions appear.

## Data Flow

```text
selected project
  -> managed Knowledge Base check
  -> Knowledge Base capability catalog
      -> full slash candidates under group 知识库
      -> quickAction subset for bottom 知识库 menu

runtime/template command support
  -> kept aligned with catalog names
```

The renderer should not scan the template directory. The catalog is checked into source and can be updated when the managed Knowledge Base template changes.

The initial implementation does not need to refactor the Electron runtime allowlist. It should add an alignment test that proves every catalog name is either covered by managed Knowledge Base native slash passthrough or routed through existing skill/command handling. A later runtime cleanup can derive the allowlist from a shared non-renderer constant, but that is outside this UI-focused change.

## Isolation Rules

- Ordinary projects must not receive Knowledge Base slash candidates or quick actions.
- Scheduler, Workflow, and non-renderer Agent entry points do not get new Knowledge Base shortcut behavior.
- Managed Knowledge Base runtime files remain inside Synapse-managed backing directories.
- No `.claude`, `.agents`, `.codex`, plugin, hook, command, or skill files are written into user-visible folders.

## Error Handling

- If the selected project is not a managed Knowledge Base, return no Knowledge Base candidates.
- If a catalog item has an empty name or description, omit it in conversion helpers.
- If a quick action has empty label or command text, omit it from the quick menu.
- Empty groups should not render.

## Testing

Utility tests:

- Converts the full Knowledge Base catalog into `knowledgeBase` slash candidates.
- Groups `知识库` after `片段` and before `Skills`.
- Renders command names followed by Chinese descriptions on one line and truncates overflow.
- Derives the bottom quick menu only from entries with `quickAction`.
- Keeps `/` menu selection insert-only.
- Does not return Knowledge Base candidates for ordinary projects.

Renderer component tests:

- Managed Knowledge Base project shows a `知识库` group in the `/` menu.
- Ordinary project does not show the `知识库` group.
- Selecting `/wiki-ingest` inserts the command and does not submit.
- Bottom `知识库` menu still shows only curated quick actions.

Runtime alignment tests:

- The Knowledge Base UI catalog names are covered by managed Knowledge Base native slash passthrough or by skill/command routing.
- Existing `/wiki` command routing behavior remains unchanged.

## Implementation Boundaries

Expected renderer changes:

- `desktop/src/modules/agent/knowledge-base-commands.ts`
- `desktop/src/modules/agent/slash-menu.ts`
- `desktop/src/modules/agent/components/agent-slash-menu.tsx`
- `desktop/src/modules/agent/index.tsx`
- related Agent renderer tests

Runtime changes:

- Add or update related runtime allowlist alignment tests.
- Do not change command routing behavior unless a catalog item is currently unsupported.

Avoid changing:

- Knowledge Base source management APIs
- `wiki-command-prompts.ts` execution semantics
- Scheduler and Workflow modules
- managed Knowledge Base template files, unless the template itself intentionally changes

## Decisions

- The `/` menu gets a standalone `知识库` group.
- The `知识库` group is complete.
- Each item shows the command followed by its Chinese description on one compact line.
- The bottom `知识库` menu remains curated.
- Both surfaces come from one Knowledge Base capability catalog.
- `/` menu selection inserts only and never sends.
