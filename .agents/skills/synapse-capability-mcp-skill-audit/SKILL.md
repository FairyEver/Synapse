---
name: synapse-capability-mcp-skill-audit
description: Use when working in the Synapse repository and the user asks to check, audit, repair, or automatically synchronize a module capability with its MCP tools, built-in skill/rule/prompt templates, Agent usage guide, API reference, tests, or release notes. Trigger on requests like 检查模块能力 MCP skill 配合, 更新功能后检查 MCP 和内置 skill, capability-mcp-skill audit, workflow/scheduler/automation/content/database MCP skill sync, or “如果没问题就报告没问题，有问题就自动修改”.
---

# Synapse Capability MCP Skill Audit

## Purpose

Audit a Synapse feature/module change against all Agent-facing surfaces that must stay in sync:

- Product capability code and runtime registration.
- MCP capability domain, tool descriptions, schemas, dispatcher behavior, and tests.
- Built-in skill/rule/prompt templates under `desktop/resources/templates/`.
- Agent-facing guides and API references.
- `RELEASE_NOTES_PENDING.md` when the fix is user-visible.

If everything is aligned, report that no problem was found. If gaps exist and the user asked for automatic repair, apply focused edits and verify them.

## Modes

Infer mode from the user's wording.

| Mode | User intent | Behavior |
| --- | --- | --- |
| Audit only | "检查", "审查", "有没有问题", "audit" | Inspect and report findings. Do not edit unless the user explicitly says to fix. |
| Audit and repair | "检查并自动修改", "有问题就自动修改", "帮我同步", "repair", "fix gaps" | Inspect, summarize gaps briefly, then patch the missing MCP/template/guide/test surfaces. |
| Scoped module | User names a module such as workflow, scheduler, automation, content, database, repository, model price, variable | Limit discovery and edits to that module and directly related shared files. |

If the request says "如果没问题就报告没问题，如果有问题就自动修改", use **Audit and repair**.

## Mandatory Repository Rules

Before editing, read:

- `AGENTS.md`
- Relevant design docs found by searching `docs/` for the module name, directory name, and changed capability terms.
- Existing module implementation, MCP domain/dispatcher, built-in template skill, guide docs, and tests.

Respect `AGENTS.md`: make surgical edits, do not change `templates/`, do not add dependencies, and update `RELEASE_NOTES_PENDING.md` for user-facing or release-relevant changes.

## Surface Map

Use this map as a starting point, then verify by searching because new domains may exist.

| Domain | Capability / MCP code | Built-in skill template | Common docs/tests |
| --- | --- | --- | --- |
| workflow | `desktop/synapse-capabilities/shared/workflow-domain.ts`, `desktop/electron/capabilities/workflow-dispatcher.ts`, `desktop/workflow-nodes/`, `desktop/electron/services/workflow/` | `desktop/resources/templates/skills/synapse-workflow-mcp/` | `desktop/docs/workflow-mcp-guide.md`, `desktop/electron/capabilities/__tests__/workflow-*.test.ts`, workflow node tests |
| scheduler | `desktop/synapse-capabilities/shared/scheduler-domain.ts`, scheduler dispatcher/services | `desktop/resources/templates/skills/synapse-scheduler-mcp/` | scheduler MCP tests and specs |
| automation | `desktop/synapse-capabilities/shared/automation-domain.ts`, `desktop/electron/capabilities/automation-dispatcher.ts`, `desktop/electron/services/automation/` | `desktop/resources/templates/skills/synapse-automation-mcp/` | automation dispatcher/service tests and specs |
| content / rule / skill / prompt | `desktop/synapse-capabilities/shared/content-domain.ts`, content dispatcher/services/modules | `desktop/resources/templates/skills/synapse-content-mcp/`, affected built-in `rules/`, `skills/`, `prompts/` templates | content MCP tests, content module tests |
| database | `desktop/database/shared/`, `desktop/database/mcp/`, database dispatchers/services | `desktop/resources/templates/skills/synapse-database-mcp/` | database MCP tests |
| repository / variable / model price | matching `desktop/synapse-capabilities/shared/*-domain.ts` and `desktop/electron/capabilities/*-dispatcher.ts` | `synapse-repository-mcp`, `synapse-variable-mcp`, `synapse-model-price-mcp` | matching dispatcher/tool tests |

## Audit Workflow

### 1. Identify the Changed Capability

Determine the concrete capability added or changed:

- New node/action/tool/type/trigger/executor/config field.
- New enum option, default, output shape, validation rule, or runtime behavior.
- New user-visible workflow in UI or Agent operation.

Use `git diff --name-only`, `git diff`, and targeted `rg` searches. If the current worktree already contains some synced surfaces, compare against actual code behavior, not only commit history.

### 2. Build the Source-of-Truth List

For each changed capability, record the authoritative implementation files:

- Registration point, manifest/schema, and default config.
- Runtime executor/dispatcher/service behavior.
- Validation/sanitization/history/output behavior.
- Tests that prove the behavior.

For dynamic MCP surfaces, determine whether the MCP tool reads runtime registry/schema automatically. If yes, do not duplicate schema manually; update only static descriptions, examples, and tests that teach Agents how to discover it.

### 3. Check MCP Alignment

Inspect MCP-facing files:

- Capability list and `build*Tools()` descriptions.
- JSON Schema descriptions and examples.
- Dispatcher action handlers and validation.
- Tests that lock important Agent-facing descriptions and dynamic discovery behavior.

For every changed field/option/output, verify:

- The MCP tool can create/read/update/execute it.
- `*_type_list` / `*_type_describe` discovery includes it when applicable.
- Static tool descriptions do not list stale capabilities.
- Tests cover the new or changed discovery contract.

### 4. Check Built-In Skill And Guides

Inspect the matching built-in skill template:

- `desktop/resources/templates/skills/<domain-mcp>/meta.json`
- `content.md`
- `files/api-reference.md` when present

Also inspect matching guide docs such as `desktop/docs/*-mcp-guide.md` and relevant `docs/superpowers/specs/` or `plans/`.

Verify the template tells Agents:

- When to use the capability.
- Minimal valid config or request body.
- Required and optional fields.
- Inheritance/default behavior.
- What not to set.
- Output shape and downstream usage.
- Required call order.
- Common errors or validation gotchas.

### 5. Decide Findings

Treat these as actionable gaps:

- A runtime capability is not mentioned in static MCP descriptions or built-in skill docs.
- A field/default/inheritance rule is documented incorrectly.
- An MCP action exists but has stale schema/tool wording.
- A built-in skill tells Agents to call the wrong tool or set wrong fields.
- Tests do not cover a newly important Agent-facing discovery contract.
- Release notes omit user-visible MCP/built-in skill behavior changes.

Do not report or edit unrelated style issues, broad refactors, or implementation improvements outside the capability/MCP/skill sync boundary.

## Repair Rules

When repairing:

1. Patch the smallest set of files that makes the Agent-facing contract true.
2. Prefer dynamic discovery through existing registries over hard-coded lists.
3. Keep examples short and schema-valid.
4. Preserve existing built-in template conventions: `meta.json`, `content.md`, optional `files/api-reference.md`.
5. Parse edited `meta.json` files with `JSON.parse`.
6. Add or update focused tests for MCP tool descriptions or dispatcher discovery when code changed or static descriptions are corrected.
7. Update `RELEASE_NOTES_PENDING.md` when users or Agents gain a corrected behavior.

If the only problem is documentation saying more than code actually does, fix the documentation unless the user explicitly asked to implement the missing behavior.

## Verification

Run the narrowest checks available for the edited surfaces:

- `git diff --check`
- `node -e 'JSON.parse(require("fs").readFileSync("<meta.json>", "utf8"))'` for edited template metadata.
- Focused MCP/domain tests, for example `pnpm --filter @synapse/desktop run test -- <test paths>`.
- Focused schema/registry tests for affected node/action types.
- Text scans with `rg` for stale capability lists or wrong field names.

If dependencies are not installed or a command cannot run, report the exact command and failure reason. Still run dependency-free checks where possible.

## Report Format

For audit-only with no issues:

```text
未发现问题。已核对：实现入口、MCP 描述/schema、内置 skill/API 参考、相关指南和测试覆盖。
```

For audit-only with issues:

```text
发现问题：
- [P1] file:line — 缺口 — 影响 — 建议修复
```

For audit-and-repair:

```text
已修复：
- ...

验证：
- ...
```

Mention any checks that could not run. Keep the final answer concise.
