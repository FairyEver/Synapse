---
name: synapse-skill
description: Use when operating Synapse through MCP tools, including 发邮件、给某人发邮件、看我的邮件、收件箱、最新邮件、回复邮件、转发邮件 (ordinary mail always means external email; only explicit 站内信 means internal mail), configuring and managing locally stored external email through Alibaba or custom IMAP/SMTP accounts, reading synapse://mail/em_<uuid> references, and reading or managing account notifications and internal mail from copied synapse://mail-internal/<id> or synapse:notification:<id> references, or when the user provides a URL whose hostname is synapse.d2.pub or any subdomain, including /drive/items/... and /share/... links. Also use when checking or installing Synapse Desktop updates, fully restarting the desktop app for 帮我检查一下更新、帮我更新、帮我重启, notifying or reminding the user now or at a later point, including 提醒我、到点提醒我、完事通知我、给我手机发消息、推到我手机上, creating Synapse Agent conversations in default or specified groups, listing conversation groups and available providers/models, creating with a requested model, opening, reading, observing, or controlling a Synapse Agent conversation from its deep link, submitting 问题反馈 to Synapse, or creating, developing, modifying, migrating, or improving an Agent Skill in the current or local directory. Trigger for requests such as 开发 Skill、新建 Skill、创建 Skill、修改现有 Skill、迁移 Skill, even when the user does not explicitly name Synapse Skill. Synapse domains include cloud todos / 待办事项, completion, deadlines and reminders; Database; Drive one-time upload versus persistent local file or folder sync, including 备份、镜像、挂载、绑定到云盘、持续同步 and keep synchronized requests; 云文档、在线文档、云盘、云存储、云空间、网盘 and equivalent cloud file storage requests to browse or search files by name and metadata, refine search results, upload, get a share link, or save a file, which mean Synapse Drive unless the user explicitly names another cloud storage or document platform; local Markdown document upload or sharing with linked images and HTML; Workflow, Automation, Content, Skill Repository, model price rules, secrets, repositories, Terminal sessions, account sign-in, app capabilities including JSON repair and reaching the user through System Notifier messages; Enterprise WeChat / 企业微信 messaging through a connected WeCom bot, including 企业微信消息、企微单聊群聊、最近会话、发送文本图片文件语音视频. Trigger when the user abbreviates Synapse as sy (缩写 sy).
---

# Synapse Skill

Use this skill when the user wants to operate Synapse through MCP tools or author local Agent Skill files.

Use the canonical `app_*` names returned by search. Retired names such as `database_*`, `drive_*`, `workflow_*`, and `content_*` are not supported aliases.

Resolve the domain paths below relative to this installed `SKILL.md`. Use the Skill source supplied by the current client's catalog or its installed `synapse-skill/SKILL.md`; `.synapse-install-dir-*` directories are installation staging copies, not operational entry points. Do not search those copies for instructions or choose an arbitrary old version when a referenced file is missing.

The Synapse MCP server publishes only two tools. In Synapse Agent conversations they are `mcp__synapse-tool-router__search` and `mcp__synapse-tool-router__invoke`; in every other client they are the `search` and `invoke` tools of the `synapse-mcp` server. Each client prefixes the server name differently — Codex calls them `mcp__synapse_mcp__search` and `mcp__synapse_mcp__invoke`, and other clients may use another prefix — so match on the `search` / `invoke` suffix rather than the full name. Always call `search` first with the user's intent or the required canonical tool name, then call `invoke` with the exact original name and arguments that match the returned complete `inputSchema`. When you do not yet know which tools exist, call `search` with only a `domain` first: that returns a one-line index of the domain instead of schemas, and it is far cheaper than guessing query after query. Never guess a tool name or arguments when search returns no reliable match. If a client still lists the canonical `app_*` tools directly, call them normally instead. Router execution keeps the original tool's permissions and domain rules.

## Routing

For a user-provided URL whose hostname is `synapse.d2.pub` or one of its subdomains, use this Skill before opening or fetching the URL. Route by the URL path and the user's intent, read the matching domain guide below, and use its Synapse MCP tools. For example, `/drive/items/...` belongs to Drive item operations, while `/share/...` belongs to the Drive Link intake flow in `drive/index.md`. Do not use a browser, web search, `curl`, or a general-purpose fetcher to parse the link first. If the required Synapse MCP tool is unavailable, explain the blocker; use another method to parse the link only with the user's explicit consent.

First classify the user's intent, then read the matching domain file before using tools:

- Copied `synapse://mail-internal/<id>` -> `mail-internal/index.md`; copied `synapse:notification:<id>` -> `notifications/index.md`. The reference identifies the type even when the user says only “看这个” or “读一下”. Pass the complete reference unchanged to that domain's read tool. If the user gives only an untyped raw ID and context does not identify its source, ask which type it is.
- Creating, developing, modifying, migrating, or improving an Agent Skill in the current or local directory -> `skill-authoring/index.md`
- Database, tables, rows, columns, choices, SQL, table folders, mutation logs -> `database/index.md`
- Drive file search by name/extension and metadata, search refinements and numbered result follow-ups; files, folders, one-time upload, persistent local file or folder sync, download, preview, local Markdown document publishing with linked images or HTML, HTML page sharing, static site publishing or republishing, public assets, trash, versions; 云文档、在线文档、云盘、云存储、云空间、网盘 and equivalent terms when no other platform is explicitly named -> `drive/index.md`
- Ordinary 邮件 / 邮箱 / 收件箱 / 发邮件 / 看我的邮件 / 回复邮件 / 转发邮件 / email / Alibaba IMAP SMTP / `synapse://mail/em_<uuid>` -> `mail/index.md`. This is the default even when the user says SY/Synapse or names a person instead of an address. Only explicit 站内信/internal mail or its typed reference selects internal mail; never use team recipients for external email. With exactly one configured email account, use it without asking which sender.
- Explicit Internal mail / 站内信 or `synapse://mail-internal/<id>` -> `mail-internal/index.md`; its team recipients and attachments apply only after that explicit routing. Generic email, recipient names, replies or attachments do not select this domain.
- Enterprise WeChat / 企业微信 / 企微 messaging and connector status, including “给企业微信里的某人发消息”, “发到某个群”, “发给我” and “现在能给谁发消息” -> first read `wecom/wecomcli-shared/SKILL.md`, then `wecom/wecomcli-message/SKILL.md` for messages. These requests use Synapse's connected bot; the user need not say “机器人”. “我的企业微信” does not request sending as the user's personal account. Use a Webhook Skill only when the user explicitly specifies a Webhook or the task is already explicitly bound to that channel; never fall back to a default Webhook when a named person/group is unavailable. Official `wecom-cli ...` examples are argument specifications only: execute them through `app_wecom_cli_run`, never through a shell, and never ask for or expose credentials. Media upload is retained only as a message dependency, with instructions inside the message Skill. Synapse permanently excludes WeCom mail, contacts, document search/management, sheets, smart sheets, standalone media management, WeDrive, todos, meetings, calendar, slides and document content operations; direct these requests to the Enterprise WeChat client.
- Cloud todos / 待办事项, title/note/deadline/reminder CRUD, completion/restoration, or copied `synapse://todos/<id>` references -> `todos/index.md`
- Account notifications / 通知清单 / 消息中心, unread counts, reading, marking read, and clearing notifications -> `notifications/index.md`
- Workflow definitions, nodes, edges, DAG validation, layout, variables, providers, workflow runs -> `workflow/index.md`
- Automation items, schedules, cron/interval triggers, executors, enablement, manual runs, active runs, run history -> `automation/index.md`
- Cloud Skill repositories, local Skill upload, cloud Skill repository update, repository management URL -> `skill-repository/index.md`
- Rule, Skill, Prompt publishing and Synapse Resource Repository management, but not local Skill file authoring -> `content/index.md`
- Model price rules and used-model pricing -> `model-price/index.md`
- Local secrets and placeholder secret values -> `secrets/index.md`
- Settings repositories -> `repository/index.md`
- Synapse-managed Terminal launch settings, groups, tab layout, saved commands, sessions, opening a session by its immutable id, retained output, observation, leases, semantic input, resize, stop, and deletion -> `terminal/index.md`. These tools are `app_terminal_*` under the `app` domain; the catalog's `domains` list is top-level namespaces only, so it has no `terminal` entry. A process running inside a Synapse terminal addresses its own session through `SYNAPSE_SESSION_ID` and its tab through `SYNAPSE_WORKSPACE_ID`.
- Synapse Desktop update checks, update installation, full desktop restart, account sign-in state and signing the desktop client back in, Synapse Agent conversation deep links, conversation creation, provider/model discovery and group discovery, plus other App-provided capabilities such as text file writing, text extraction, document generation, JSON repair, reaching the user through System Notifier (提醒、通知、推到手机), and problem feedback -> `app/index.md`

When there is specific evidence that Synapse itself or a built-in Synapse Skill violates a documented or otherwise verified product contract, read `app/index.md` before suggesting problem feedback. Do not suggest feedback for ordinary validation, permission, rate-limit, transient network, user-project, third-party, editor, speculative, or purely aesthetic issues.

Treat an App-provided capability configured inside a Workflow as a Workflow operation. Read `workflow/index.md` for its node schema, bindings, edges, validation, and execution behavior; do not also read `app/index.md` merely because the node is backed by an App capability. Read `app/index.md` when directly invoking an `app_*` capability tool outside a Workflow definition. A Workflow containing App-backed nodes is not automatically a multi-domain task.

If the task spans multiple domains, handle each part in order and read each relevant domain file.

Treat “云文档”, “在线文档”, “云盘”, “云存储”, “云空间”, “网盘”, and equivalent generic cloud file storage terms as names for Synapse Drive, including possessive forms such as “我的网盘”, unless the user explicitly identifies another cloud storage or document platform. Route by the requested action; these names alone do not request a format conversion, public share, or persistent sync.

If the user message contains `sss`, treat it as Synapse Services Shortcut. Infer the real domain from surrounding intent. Do not default to Database just because `sss` appears.

If the user message contains `sy` (case-insensitive) as a standalone word, read it as the abbreviation for Synapse and infer the requested capability from the surrounding intent; for example, `用 sy 查一下云盘` means query Synapse Drive. Keep the literal meaning only when the request clearly uses `sy` as a code identifier, command name, or term defined by the current project or repository.

For scheduled-task, scheduler, cron, interval, enable/disable, run-history, or runtime-state requests, use the current Automation domain. Legacy `scheduler_*` MCP tools are retired and are not supported aliases.

## Showing Links To The User

When the answer includes a Synapse link for the user to open — a share link, a Drive item link, a site or public asset link, or a `synapse://` deep link — write the URL itself out, on a line of its own or inside a plain sentence. Do not hide it behind Markdown link text. When the user wants that address on their phone, hand it over with `app_system_notifier_notification_trigger` and its `url` field (`app/index.md`) instead of expecting them to read it off the terminal. When what the user wants on their phone is a piece of text rather than an address — a passphrase, a command, a short piece to paste — send that text as `body` with `copyOnTap: true`, and one tap on the notification copies it; `title` stays a label and is never copied (`app/index.md`).

## Boundaries

Use only the domain guidance that matches the current task. Do not apply Workflow rules to Automation items, Drive rules to local files unless the user asks for a Drive upload or sync operation, or Database SQL rules to Resource Repository resources.

For local Skill file authoring, read `skill-authoring/index.md`. Do not also read `content/index.md` unless the user asks to publish or manage the Skill in Synapse. A request only to publish or manage an existing Skill in Synapse is a Content operation, not local Skill authoring.

Before destructive operations, follow the safety rules in the relevant domain file and ask when the user's intent is ambiguous.

Do not quote or log tokens, Authorization headers, cookies, share passwords, presigned URLs, or other secrets returned by tools.
