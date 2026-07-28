---
name: synapse-skill
description: Use when operating Synapse through MCP tools or submitting 问题反馈 to Synapse, including Database, Drive, local Markdown document upload or sharing with linked images and HTML, Workflow, Automation, Content, Skill Repository, model price rules, secrets, repositories, Terminal sessions, and app capabilities.
---

# Synapse Skill

Use this skill when the user wants to operate Synapse through MCP tools.

Use only the canonical `app_*` MCP tool names documented by each domain. Retired names such as `database_*`, `drive_*`, `workflow_*`, and `content_*` are not supported aliases.

## Routing

First classify the user's intent, then read the matching domain file before using tools:

- Database, tables, rows, columns, choices, SQL, table folders, mutation logs -> `database/index.md`
- Drive files, folders, upload, download, preview, local Markdown document publishing with linked images or HTML, HTML page sharing, static site publishing or republishing, public assets, trash, versions -> `drive/index.md`
- Workflow definitions, nodes, edges, DAG validation, layout, variables, providers, workflow runs -> `workflow/index.md`
- Automation items, schedules, cron/interval triggers, executors, enablement, manual runs, active runs, run history -> `automation/index.md`
- Cloud Skill repositories, local Skill upload, cloud Skill repository update, repository management URL -> `skill-repository/index.md`
- Rule, Skill, Prompt publishing and Resource Repository management -> `content/index.md`
- Model price rules and used-model pricing -> `model-price/index.md`
- Local secrets and placeholder secret values -> `secrets/index.md`
- Settings repositories -> `repository/index.md`
- Synapse-managed Terminal groups, sessions, retained output, observation, leases, semantic input, resize, stop, and deletion -> `terminal/index.md`
- Other App-provided capabilities such as text file writing, text extraction, document generation, JSON repair, Sound Notifier playback, System Notifier notifications, and problem feedback -> `app/index.md`

When there is specific evidence that Synapse itself or a built-in Synapse Skill violates a documented or otherwise verified product contract, read `app/index.md` before suggesting problem feedback. Do not suggest feedback for ordinary validation, permission, rate-limit, transient network, user-project, third-party, editor, speculative, or purely aesthetic issues.

Treat an App-provided capability configured inside a Workflow as a Workflow operation. Read `workflow/index.md` for its node schema, bindings, edges, validation, and execution behavior; do not also read `app/index.md` merely because the node is backed by an App capability. Read `app/index.md` when directly invoking an `app_*` capability tool outside a Workflow definition. A Workflow containing App-backed nodes is not automatically a multi-domain task.

If the task spans multiple domains, handle each part in order and read each relevant domain file.

If the user message contains `sss`, treat it as Synapse Services Shortcut. Infer the real domain from surrounding intent. Do not default to Database just because `sss` appears.

For scheduled-task, scheduler, cron, interval, enable/disable, run-history, or runtime-state requests, use the current Automation domain. Legacy `scheduler_*` MCP tools are retired and are not supported aliases.

## Boundaries

Use only the domain guidance that matches the current task. Do not apply Workflow rules to Automation items, Drive rules to local files, or Database SQL rules to Resource Repository resources.

Before destructive operations, follow the safety rules in the relevant domain file and ask when the user's intent is ambiguous.

Do not expose tokens, Authorization headers, cookies, share passwords from list results, presigned URLs, or other secrets returned by tools.
