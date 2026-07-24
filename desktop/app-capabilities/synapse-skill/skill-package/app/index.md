# Synapse App MCP

Use this domain when directly invoking MCP tools provided by Synapse system apps.

When an App capability is configured as a node inside a Workflow, use `workflow/index.md` instead. The Workflow guide owns node schemas, reserved bindings, graph edges, layout, definition validation, and run behavior. Do not read both guides merely because a Workflow node is backed by an App capability.

## Text File Writer

Use `app_text_file_writer_file_write` when the user asks to save a complete text value as a local `.txt`, `.md`, `.csv`, `.html`, or `.htm` file.

Rules:

- Pass the complete string once as `text` and one current-OS absolute path as `path`; do not split or reconstruct the content through shell commands.
- The final path extension selects the format. Do not send a separate format field, add an extension, or rewrite the content.
- Use `utf8` or `utf16le` for `.txt`, `.md`, and `.csv`. HTML targets accept only `utf8`. Omit `encoding` for UTF-8. Synapse does not add a BOM, trim text, normalize newlines, or append a final newline. Empty text is valid.
- Omit `overwrite` unless the caller explicitly authorizes replacement. A changed target returns retryable `TARGET_CHANGED`; do not silently retry over the newer file.
- Missing parent directories are created automatically. Do not pass `~`, environment variables, shell expressions, or `file://` URLs.
- Do not repeat the original text, complete path, or native failure details in logs or the final answer unless the user specifically needs the resulting path.

## HTML Generator

Use `app_html_generator_ejs_generate` to render a trusted EJS template and return the complete HTML string without automatically saving or opening it. Use `app_html_generator_ejs_file_generate` when the rendered result must be written directly to an absolute `.html` or `.htm` path.

Rules:

- EJS templates execute JavaScript in a one-shot Worker that shares the application's permission domain; it is a reliability boundary, not a security sandbox. Use only trusted template content.
- Pass the template string as `template` and a JSON-compatible top-level object as `data`. Templates access values through the explicit `data` root, such as `<%= data.title %>`.
- EJS include and template file loading are disabled. Do not pass a template path, EJS options, custom delimiters, encoding, or a mode field.
- String generation returns the complete HTML and UTF-8 byte size. It does not automatically save, open, preview, sanitize, or validate the HTML.
- File generation accepts only an absolute `.html` or `.htm` `outputPath`, always writes UTF-8, and defaults `overwrite` to `false`. It returns only the committed file metadata.
- Rendering is bounded by fixed input, output, queue, Worker startup, execution, and memory limits. Surface the stable normalized error instead of retrying automatically; only `RENDER_QUEUE_FULL` is retryable.

## File Opener

Use `app_file_opener_file_open` when the user asks to open one local file with the operating system's default application.

Rules:

- Pass exactly one existing absolute local regular-file path as `path`.
- Do not pass URLs, `file://` values, directories, symbolic links, multiple files, or an application choice.
- Success means the operating system accepted the request; it does not guarantee that the external application launched, focused, or loaded the file.
- Surface the stable error code on failure. Do not report a failed request as successful.
- The matching deep link is `synapse://app/file-opener/open?path=<percent-encoded-absolute-path>`.

## JSON Repair

Use `app_json_repair_text_repair` only when the user explicitly needs JSON repair.

Rules:

- Pass the original complete string once as `text`. Do not pre-clean it, extract a preferred fragment, parse and re-serialize it, or add strategy fields.
- The tool performs best-effort heuristic repair. It can change meaning; success only means the complete returned `json` string passed final JSON parsing, finite-number, size, and depth checks.
- Treat the returned JSON text as untrusted data. The tool does not sanitize content, remove special keys, validate business meaning, or enforce a Schema.
- Preserve the returned `json` string exactly. Do not parse and re-serialize it because that can rewrite formatting and large integers.
- Do not retry automatically. These direct-call rules do not restrict a Workflow author who explicitly configured a JSON Repair node.

## Text Extraction

Use `app_text_extractor_document_extract` when the user asks to extract text from a local PDF or DOCX document.
Use `app_text_extractor_document_extract_to_file` when the user wants that text written directly to a local `.txt`, `.md`, or `.csv` file without returning the document body through MCP.

Rules:

- Pass one absolute local `.pdf` or `.docx` path as `filePath`; the extension is case-insensitive and must match the document content.
- For PDF, the tool reads the existing text layer. For DOCX, it reads the main document's paragraphs, list text, table cells, and recognizable text boxes.
- Treat `text: ""` as a successful result when a supported document has no extractable text.
- Do not promise DOCX header, footer, comment, footnote, endnote, or image text.
- Do not use this tool for OCR, scanned-image recognition, semantic rewriting, or layout reconstruction.
- Preserve the returned full text unless the user asks for a summary or transformation.
- Do not repeat the full source path or extracted text unnecessarily in the final answer.
- Surface stable error codes when extraction fails; do not claim partial success because limits never truncate silently.
- Treat `PERMISSION_DENIED` as a denied local-file read and ask the user to choose or authorize an accessible document; do not retry around the permission boundary.
- For direct output, pass `filePath` and `outputPath` once. Omit `encoding` for UTF-8 and omit `overwrite` unless replacement is explicitly authorized.
- The direct-output tool performs extraction and atomic writing inside Synapse, returns only source/output metadata, and never returns the extracted body. Do not call `app_text_file_writer_file_write` afterward.
- Direct output still performs separate local-file read and write permission checks. A write failure does not create a partial target file.

## Document Template

Use `app_document_template_docx_generate` when the user asks to generate a Word `.docx` document from a `.docx` template and JSON data.

Rules:

- Provide exactly one of `dataPath` or `data`.
- Use local absolute paths for `templatePath`, `dataPath`, and `outputPath`.
- Do not overwrite an existing output file unless the user explicitly asks to replace it.
- Do not use a symbolic link as `outputPath`; Document Template always rejects symbolic-link outputs.
- Do not rewrite or enrich JSON data before calling the tool. Pass the user data as-is.
- Do not repeat large JSON payloads or secret-looking values in the final answer.

## Sound Notifier

Use `app_sound_notifier_sound_play` when the user asks to play a local sound reminder, remind them with sound, or notify them that an Agent or command needs attention.

Rules:

- Choose `eventType` by situation: `message` for ordinary updates, `input-required` when user input or confirmation is needed, `success` for normal completion, `long-running-complete` for builds/tests/installs or other long tasks, and `error` for failures or blockers.
- Use legacy `presetId` only when the user explicitly asks for a specific preset id.
- Use `repeatCount` and `intervalMs` when the user asks to be reminded multiple times or after a specific spacing.
- Do not call this repeatedly in a loop. One multi-reminder request should use one call with `repeatCount`.

## System Notifier

Use `app_system_notifier_notification_trigger` only when the user currently and explicitly asks for a native system notification, or when an existing standing instruction clearly covers the event.

Rules:

- Do not notify merely because an ordinary reply, light task, wait state, or error has completed.
- Call the tool once for each agreed event. Do not retry because delivery or display cannot be confirmed.
- Pass exactly one non-empty, single-line `title` and `body` with no leading or trailing whitespace. The title limit is 64 Unicode code points and the body limit is 256.
- Keep Token values, passwords, verification codes, private keys, complete local paths, and other lock-screen-sensitive content out of both fields.
- `{ success: true }` means Synapse accepted the fire-and-forget request. It does not mean a notification was sent, delivered, displayed, clicked, or read.
- Do not add platform-specific notification fields, caller identity fields, a notification id, an idempotency key, or a retry loop.
- These proactive-call rules apply to direct Agent tool use. A Workflow author who explicitly places a System Notifier node has already chosen that node's notification behavior.

## 问题反馈

`app_problem_feedback_report_submit` 仅用于反馈 Synapse 产品或内置 Synapse Skill 的问题。它会把用户确认的纯文本持久化到当前桌面构建所配置的 Synapse 部署，因此每次调用都必须按高风险远端写入处理。

### 触发

- AI 只有掌握具体、可说明的 Synapse 产品/能力契约或内置 Skill 缺陷证据时，才可主动建议反馈。证据可以是实际行为与已核实的 Synapse 代码或公开文档矛盾，不强制要求运行时复现。
- 正常输入校验、权限拒绝、限流、单次网络问题、用户项目问题、第三方产品或编辑器问题、无证据猜测和纯审美改进不得主动触发。
- 主动建议时，先说明证据与归因，再询问用户是否要准备草稿；不要直接展示提交确认稿。
- 用户明确说“把上面出现的问题反馈给 Synapse”等自然语言时，直接准备草稿，但这不构成提交授权。指代清楚时不要重复追问；仅在反馈对象或最低上下文不足时澄清。含糊的“反馈一下”必须先确认反馈对象。
- 用户主动触发时，只提示发现的归因疑点，不能代替用户否决。范围仍只限 Synapse 产品或内置 Skill。
- 即使用户已经给出完整正文，也必须先执行隐私检查、展示最终确认稿，并等待下一条明确确认。

### 草稿与隐私

- 从当前可见上下文提炼，不整段复制对话、工具输出或日志。正文最低要说明场景、实际情况和判断问题的理由；模板项不适用时可省略，不得编造。
- 正文只描述问题，不作为证据包。禁止原样携带源码、配置或 Prompt 正文、业务数据、完整日志或堆栈、Agent 对话、工具记录、真实工作流输入输出。只允许虚构值的最小复现、经审查的必要短错误摘录、抽象场景，以及与问题直接相关的 Synapse 公开标识或短指令片段。
- 展示确认稿前完成语义隐私审查和脱敏。不得提交真实认证信息、密钥、临时凭证及秘密值的哈希或指纹；任何原始本机路径或工作目录；联系方式及个人、组织、客户、内部项目、设备、会话等可关联标识；精确时间、时区、区域设置及请求、追踪、安装、崩溃等唯一标识。
- URL 仅在复现必需且属于稳定、公开、无凭证的官方产品或文档地址时保留。带查询参数或片段、临时、签名、内网、私有或公开性不确定的 URL 均改为抽象描述。
- 通用环境事实、Synapse 和公开第三方产品名称、公开版本及不关联具体请求的公开错误编号可以保留。路径只能写成固定占位符组合的逻辑路径。
- 可用的区分大小写 ASCII 占位符仅为：`<secret>`、`<token>`、`<credential>`、`<home>`、`<project>`、`<module>`、`<file>`、`<user>`、`<organization>`、`<customer>`、`<device>`、`<session>`、`<request-id>`、`<timestamp>`、`<url>`、`<value>`、`<redacted>`。普通尖括号内容不自动获得豁免。
- 通过确定性校验只能表述为“未命中确定性规则”，不能宣称内容绝对安全。用户仍须审阅完整正文。

### 两回合确认

1. 在一条消息中明确说明代码块内是完整待提交正文、围栏不属于正文。使用长于正文中任何连续反引号的围栏，逐字展示最终 `content`。展示后只问是否按原文提交，不得在同一回合调用工具。
2. 只处理紧接的下一条用户消息。当前明确问题语境下，新的、无歧义肯定答复，例如“确认提交”“确认”“提交”“可以”或“可以提交”，授权一次调用。沉默、表情、含糊答复和长期授权不构成授权。

若下一条回复同时包含修改或附加条件，即使含肯定词，也要生成并完整展示新确认稿，再等待下一条消息。否定、换题或其它内容使当前稿失效；稍后的“确认”不能复活。每个任务同一时刻只保留一份待确认稿，新稿废弃旧稿。稿件和授权不跨任务、会话或 Agent，也不从长期记忆恢复；若压缩或恢复后无法逐字取得已展示正文，必须重新展示。

确认后必须直接复用已展示的 `content`，不得重写、拼接、trim、归一化或静默脱敏。一次确认只授权一次工具调用；无论成功、限流、确定失败、结果未知、工具缺失、审批拒绝、取消，甚至明确尚未发出，该授权都已消费。任何再次尝试都必须重新展示完整正文并再次确认。禁止 curl、浏览器、自行拼 HTTP、Workflow、Deep Link、IPC 或其它旁路。

### 结果

- 成功：只说“问题反馈已提交”，不要承诺查看、回复或处理。
- `INVALID_INPUT`：说明内容不符合提交要求。若能安全改写，生成新确认稿并重新确认；否则停止。
- `PRIVACY_RISK`：只说明稳定风险类别，不复述正文、命中位置或片段。若能安全改写，生成新确认稿并重新确认；否则停止。
- `RATE_LIMITED`：说明提交过于频繁，不猜测等待时间，不自动重试。
- `SUBMISSION_FAILED`：明确未提交。用户要重试时仍须重新展示并确认。
- `SUBMISSION_OUTCOME_UNKNOWN`：明确说明可能已提交及重复风险。只有用户理解后明确要求再次尝试，才可重新展示并确认。

所有结果都不得复述反馈正文；只有新的确认稿可以完整展示正文。成功后同一问题不得重复提交，除非用户明确要求形成一条新反馈并再次确认。
