# Content MCP

<!-- Sources: desktop/synapse-capabilities/shared/content-domain.ts; desktop/electron/capabilities/content-dispatcher.ts; desktop/electron/services/content-capability-validator.ts; desktop/electron/services/content-skill-source-service.ts; desktop/electron/services/content-icon-image-service.ts; desktop/electron/services/content-submission-service.ts; desktop/resources/templates/skills/synapse-skill/files/content -->

## 功能范围

Content MCP 用于通过 MCP 发布和维护 Synapse 内容资源。当前支持 Rule、Skill 和 Prompt 的查询、新建、更新和删除。

可用工具包括 `content_type_describe`，以及 `content_rule_*`、`content_skill_*`、`content_prompt_*` 三组资源工具。创建或更新前应先调用 `content_type_describe` 获取字段要求、分类、图标、背景色和限制。

Content MCP 只写入内容仓库，不负责安装到编辑器。安装仍通过 Synapse 的编辑器安装能力完成。

## 使用方式

列出或查看资源时，使用对应类型的 `list` 和 `get` 工具。更新或删除前，先调用 `get`，再把返回的 `latestHistoryDirname` 作为 `baseHistoryDirname` 传入 update 或 delete。

创建 Rule 时提供 `name`、`title`、`description`、`category`、`content` 和外观字段。创建 Prompt 时不需要 `name`。创建 Skill 时除基础字段外，可提供附件。

Skill 附件有两种方式：

- `files`：逐个传入相对路径和文本或 base64 内容。
- `sourceDirectoryPath`：导入一个本地 Skill 目录。

两种方式不能同时使用。使用 `sourceDirectoryPath` 时，Synapse 读取 Skill 主文件，导入非隐藏附件，并在未显式传字段时使用主文件 frontmatter 中的元数据。

## 外观与图片

使用内置图标时，设置 `iconType` 为 `icon`，并从 `content_type_describe` 返回的 `icon` 和 `iconBg` 值中选择。

使用图片时，设置 `iconType` 为 `image`，并提供 `iconImagePath` 或 `iconImageBase64` 中的一个。Synapse 会校验图片输入，将图片居中裁剪并缩放为 256 x 256 PNG，最终保存为 `icon.png`。

使用 `sourceDirectoryPath` 更新 Skill 且不更换图标时，可以省略外观字段；Synapse 会保留当前内置图标或图片图标。

## 权限与限制

当前资源仓库可写时，Skill 支持协作更新：即使由其他仓库身份创建，也可以通过 Content MCP 修改；原创建者信息保持不变，版本记录本次修改者。Skill 的删除、恢复和永久删除仍只允许原创建者操作。Rule 和 Prompt 的更新、删除仍只允许原创建者操作。

以上规则只适用于资源仓库，不改变云端 Skill Repository 的 owner 权限模型。

MCP 更新和删除不支持 `force`。当 `baseHistoryDirname` 与最新版本不一致时，操作返回冲突信息，调用方需要重新读取最新内容后再决定如何处理。

Skill 附件会进行路径归一化、重复路径检查、大小检查和敏感文件名检查。附件路径应始终是相对路径，不应包含绝对路径或路径穿越。

## 内置 Skill

Synapse MCP 的内置 Skill 已合并为 `synapse-skill`。Content 域说明位于该模板的 content 文件中，用于指导 Agent 使用 Content MCP。
