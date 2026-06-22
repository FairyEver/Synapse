# Synapse Skill Consolidation Design

## Goal

Consolidate the built-in Synapse MCP skills into a single built-in skill named `synapse-skill`.

The new skill should solve four problems at once:

- Reduce noise in the built-in Skill list.
- Let users install Synapse MCP guidance once instead of installing each domain separately.
- Give agents one stable entry point that routes by user intent.
- Keep maintenance modular by preserving one domain folder per Synapse capability.

## Current State

Synapse currently ships separate built-in Skill templates under `desktop/resources/templates/skills/` for each Synapse MCP domain:

- `synapse-automation-mcp`
- `synapse-content-mcp`
- `synapse-database-mcp`
- `synapse-drive-mcp`
- `synapse-model-price-mcp`
- `synapse-repository-mcp`
- `synapse-variable-mcp`
- `synapse-workflow-mcp`

Each template has its own `meta.json`, `content.md`, and usually a `files/api-reference.md` attachment.

This works, but it creates too many built-in resources and asks users to install many closely related skills.

## Proposed Structure

Add one new built-in Skill template:

```text
desktop/resources/templates/skills/synapse-skill/
  meta.json
  content.md
  files/
    automation/
      index.md
      api-reference.md
    content/
      index.md
      api-reference.md
    database/
      index.md
      api-reference.md
    drive/
      index.md
      api-reference.md
    model-price/
      index.md
      api-reference.md
    repository/
      index.md
      api-reference.md
    variable/
      index.md
      api-reference.md
    workflow/
      index.md
      api-reference.md
```

The main `content.md` is a router. It should stay short and only define:

- When to use Synapse Skill.
- How to classify the user's intent.
- Which reference file to read for each domain.
- How to handle cross-domain requests.
- Shared safety rules that apply to all Synapse MCP operations.

Domain-specific instructions move into the corresponding folder under `files/`. Each domain folder should have an `index.md` as the secondary entry point and may keep supporting references such as `api-reference.md`, examples, checklists, or tool-specific notes beside it.

## Routing

The router should classify requests by domain:

- Database, tables, rows, columns, choices, SQL, table folders, mutation logs -> `database/index.md`
- Drive files, folders, upload, download, preview, share links, public assets, trash, versions -> `drive/index.md`
- Workflow definitions, nodes, edges, DAG validation, layout, workflow runs -> `workflow/index.md`
- Automation items, triggers, executors, manual runs, active runs, run history -> `automation/index.md`
- Rule, Skill, Prompt publishing and content resource management -> `content/index.md`
- Model price rules -> `model-price/index.md`
- User-scoped local variables -> `variable/index.md`
- Configured Synapse repositories -> `repository/index.md`

If a request spans multiple domains, the skill should route sequentially and apply the relevant reference file for each part.

If a request contains `sss`, the skill should treat it as the Synapse Services Shortcut and infer the real domain from the surrounding intent. It must not default to Database just because `sss` appears.

## Removed Built-In Templates

Remove these built-in templates from the repository:

- `desktop/resources/templates/skills/synapse-automation-mcp/`
- `desktop/resources/templates/skills/synapse-content-mcp/`
- `desktop/resources/templates/skills/synapse-database-mcp/`
- `desktop/resources/templates/skills/synapse-drive-mcp/`
- `desktop/resources/templates/skills/synapse-model-price-mcp/`
- `desktop/resources/templates/skills/synapse-repository-mcp/`
- `desktop/resources/templates/skills/synapse-variable-mcp/`
- `desktop/resources/templates/skills/synapse-workflow-mcp/`

Do not remove `synapse-test-skill`; it verifies Skill installation and bundled attachment access.

Do not remove `bark-notification`; it is not a Synapse MCP skill.

## Metadata

Use a single built-in Skill identity:

- Template directory: `synapse-skill`
- `meta.json` id: `synapse-skill`
- Skill name: `synapse-skill`
- User-facing title: `Synapse Skill`
- Category: `automation`
- Icon: reuse an existing content icon, preferably `terminal` or `workflow`
- Icon background: reuse an existing content color token, preferably the existing teal-like Synapse MCP choice if available

The description should be concise and trigger broad Synapse MCP usage, for example:

> Use when operating Synapse through MCP tools, including Database, Drive, Workflow, Automation, Content, model price rules, variables, and repositories.

## Compatibility

Deleting built-in templates removes them from the built-in resource list for new browsing and new installs.

It does not automatically uninstall copies that users already installed into local editor Skill directories. Existing local copies may continue to be discovered by editors until the user removes them or Synapse provides a separate cleanup flow.

This is acceptable for the first implementation. The consolidation should not perform automatic deletion from user editor directories.

## Implementation Scope

The first implementation should only change built-in template files and focused tests that validate built-in template loading.

It should not add a migration system, editor cleanup flow, or UI hidden-state mechanism.

It should not change the generic Skill install format. Installed Skills still use one root `SKILL.md` plus optional attachments.

The installed Skill should therefore be organized as one primary `SKILL.md` at the root, plus domain folders containing secondary Markdown files and reference files. Do not collapse domain details into the root `SKILL.md`, and do not keep all domain files flat in the root attachment directory.

## Validation

Required checks:

- Parse the new `meta.json`.
- Confirm `builtin__skill__synapse-skill` appears in built-in Skill listings.
- Confirm the removed built-in Skill ids no longer appear in built-in Skill listings.
- Confirm `synapse-test-skill` and `bark-notification` still appear.
- Confirm attachments for the new Skill include all domain folders, each required `index.md`, and the expected reference files.
- Run focused tests for repository template and built-in content loading.
- Run desktop typecheck if implementation touches TypeScript.

## Release Note

Because this changes a user-visible built-in resource list, update `RELEASE_NOTES_PENDING.md`.

Suggested release note:

> 内置 Synapse MCP 技能合并为一个 Synapse Skill，安装入口更清爽，技能内部会按数据库、云盘、工作流、自动化等意图路由到对应说明。
