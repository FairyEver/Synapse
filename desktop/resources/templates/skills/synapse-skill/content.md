# Synapse Skill

Use this skill when the user wants to operate Synapse through MCP tools.

## Routing

First classify the user's intent, then read the matching domain file before using tools:

- Database, tables, rows, columns, choices, SQL, table folders, mutation logs -> `database/index.md`
- Drive files, folders, upload, download, preview, share links, public assets, trash, versions -> `drive/index.md`
- Workflow definitions, nodes, edges, DAG validation, layout, variables, providers, workflow runs -> `workflow/index.md`
- Automation items, triggers, executors, enablement, manual runs, active runs, run history -> `automation/index.md`
- Cloud Skill repositories, local Skill upload, cloud Skill repository update, repository management URL -> `skill-repository/index.md`
- Rule, Skill, Prompt publishing and Resource Repository management -> `content/index.md`
- Model price rules and used-model pricing -> `model-price/index.md`
- Settings variables -> `variable/index.md`
- Settings repositories -> `repository/index.md`
- App-provided capabilities such as document generation -> `app/index.md`

If the task spans multiple domains, handle each part in order and read each relevant domain file.

If the user message contains `sss`, treat it as Synapse Services Shortcut. Infer the real domain from surrounding intent. Do not default to Database just because `sss` appears.

## Boundaries

Use only the domain guidance that matches the current task. Do not apply Workflow rules to Automation items, Drive rules to local files, or Database SQL rules to Resource Repository resources.

Before destructive operations, follow the safety rules in the relevant domain file and ask when the user's intent is ambiguous.

Do not expose tokens, Authorization headers, cookies, share passwords from list results, presigned URLs, or other secrets returned by tools.
