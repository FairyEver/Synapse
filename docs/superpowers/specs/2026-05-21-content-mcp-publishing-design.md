# Synapse Content MCP Publishing 设计文档

**日期**: 2026-05-21  
**主题**: 将 Synapse 内容资源发布与管理能力暴露给 MCP

## 背景

Synapse 目前已经有内容仓库、内容创建/更新/删除、内容索引、内置模板、编辑器安装和编辑器扫描发布链路。MCP 侧当前只公开 `database`、`scheduler`、`workflow` 三个 domain，外部 Agent 无法通过 MCP 创建、更新或删除 Synapse 的 Rule、Skill、Prompt 内容资源。

用户希望 Agent 能通过 MCP 发布内容，例如：

- 根据用户描述设计一个 Skill 并发布到 Synapse。
- 将编辑器里已有的 Skill 目录发布到 Synapse。
- 创建或维护 Rule、Prompt。
- 在更新和删除时保护团队内容，禁止 Agent 修改或删除别人创建的资源。

第一版只做 Synapse 内容仓库里的发布与管理，不做安装到编辑器。

## 目标

- 新增 `content` capability domain。
- 公开 Rule、Skill、Prompt 三类资源的 list/get/create/update/delete MCP 工具。
- 公开内容类型描述工具，让 Agent 获取字段、分类、图标、背景色、附件限制和图片限制。
- 复用现有分类、图标、背景色、内容类型和校验逻辑，不为 MCP 重复声明事实源。
- 支持 Skill 附件层级路径和从本机已有 Skill 目录导入。
- 支持 icon 模式和 image 模式的内容图标。
- `update` 和 `delete` 只能作用于当前 repo profile 创建的资源。
- `update` 和 `delete` 必须带 `baseHistoryDirname`，不向 MCP 暴露 `force`。

## 非目标

- 不做安装到编辑器。
- 不做 Prompt 安装；现有 Prompt 内容类型本身不支持安装到编辑器。
- 不通过 MCP 创建或修改分类、图标、背景色。
- 不让 MCP 绕过内容仓库的提交、索引、pending push 机制。
- 不做附件增量 patch API。Skill 更新时附件采用整组替换或保留原附件。
- 不改变 UI 现有删除/更新权限行为。第一版权限限制只作用于 MCP content 能力。

## 能力模型

新增一个 `content` domain，不拆成 `rule`、`skill`、`prompt` 三个 domain。三类资源作为 `content` 下的显式 resource：

| Capability id | MCP tool | 说明 |
| --- | --- | --- |
| `content.type.describe` | `content_type_describe` | 描述内容类型、字段、选项和限制 |
| `content.rule.list` | `content_rule_list` | 列出 Rule |
| `content.rule.get` | `content_rule_get` | 获取 Rule 详情 |
| `content.rule.create` | `content_rule_create` | 创建 Rule |
| `content.rule.update` | `content_rule_update` | 更新自己创建的 Rule |
| `content.rule.delete` | `content_rule_delete` | 删除自己创建的 Rule |
| `content.skill.list` | `content_skill_list` | 列出 Skill |
| `content.skill.get` | `content_skill_get` | 获取 Skill 详情 |
| `content.skill.create` | `content_skill_create` | 创建 Skill |
| `content.skill.update` | `content_skill_update` | 更新自己创建的 Skill |
| `content.skill.delete` | `content_skill_delete` | 删除自己创建的 Skill |
| `content.prompt.list` | `content_prompt_list` | 列出 Prompt |
| `content.prompt.get` | `content_prompt_get` | 获取 Prompt 详情 |
| `content.prompt.create` | `content_prompt_create` | 创建 Prompt |
| `content.prompt.update` | `content_prompt_update` | 更新自己创建的 Prompt |
| `content.prompt.delete` | `content_prompt_delete` | 删除自己创建的 Prompt |

不使用一个泛型 `content_item_create`。显式工具能让 Agent 更清楚字段差异，尤其是 Skill 的附件和 Rule/Skill 的 `name` 字段。

## 字段模型

三类资源共享基础字段：

- `title`
- `description`
- `category`
- `content`
- `usage`
- `iconType`
- `icon`
- `iconBg`
- `iconImagePath`
- `iconImageBase64`

Rule 额外字段：

- `name`

Skill 额外字段：

- `name`
- `files`
- `sourceDirectoryPath`

Prompt 不需要 `name` 和附件。

`iconType` 支持：

- `icon`：必须提供合法 `icon` 和 `iconBg`。
- `image`：必须提供 `iconImagePath` 或 `iconImageBase64`，内部处理为 `icon.png`。

## Metadata Describe

`content_type_describe` 是 Agent 创建或更新前的入口。`contentType` 可选；不传时返回三类资源。

返回内容包括：

- 内容类型基础信息：`type`、`label`。
- 必填字段、可选字段。
- 分类：来自 `getContentTypeDefinition(type).categories`。
- 图标：来自 `SYNAPSE_CONTENT_ICON_OPTIONS`，只返回 `value`、`label`。
- 背景色：来自 `SYNAPSE_CONTENT_COLOR_OPTIONS`，只返回 `value`、`label`。
- 默认值：例如 `iconType: "icon"`、默认 `iconBg`。
- Skill 附件限制。
- 图片图标限制。
- 更新/删除说明：需要先 get，使用返回的 `latestHistoryDirname` 作为 `baseHistoryDirname`。

该工具不返回 UI className、React 组件或 Tailwind class。MCP 只需要稳定的业务值。

## 创建与更新

Create 调用现有内容写入链路，最终复用 `contentSubmissionService.createContent`。

Update 调用前必须：

1. 校验入参。
2. 读取当前 detail。
3. 校验资源存在。
4. 校验 `createdBy === 当前 repo profile userId`。
5. 校验 `baseHistoryDirname` 与当前 `latestHistoryDirname` 一致。
6. 调用现有更新链路。

MCP update 不开放 `force`。

字段更新采用完整 payload 语义。Agent 应先 `get`，基于当前 detail 合成更新 payload，再调用 update。

Skill 附件更新规则：

- 未传 `files` 且未传 `sourceDirectoryPath`：保留原附件。
- 传 `files`：用这组附件作为更新后的完整附件集合。
- 传 `sourceDirectoryPath`：扫描目录，将扫描结果作为完整附件集合。
- `files` 与 `sourceDirectoryPath` 不能同时传。

## 删除权限

Delete 调用前必须：

1. 校验 `id` 和 `baseHistoryDirname`。
2. 读取当前 detail。
3. 校验资源存在。
4. 校验 `createdBy === 当前 repo profile userId`。
5. 校验 `baseHistoryDirname` 与当前 `latestHistoryDirname` 一致。
6. 调用现有删除链路。

“自己发布”以 `createdBy` 为准，不以 `modifiedBy` 为准。别人创建的资源，即使当前用户后来修改过，也不能通过 MCP 删除。

MCP delete 不开放 `force`。

## Skill 附件输入

### 直接构造附件

`content_skill_create` 和 `content_skill_update` 支持 `files`：

```json
[
  {
    "path": "references/checklist.md",
    "contentText": "# Checklist\n..."
  },
  {
    "path": "assets/example.bin",
    "contentBase64": "AAECAwQ="
  }
]
```

规则：

- `path` 是 Skill 内相对路径。
- `contentText` 和 `contentBase64` 二选一。
- 文本附件使用 `contentText`。
- 二进制附件使用 `contentBase64`。
- 内部把 `path` 映射为现有 `SynapseCreateSkillFilePayload.originalName`。

路径和大小校验复用或抽出已有附件规则：

- 使用 `normalizeContentAttachmentPath` 规范化路径。
- 空路径拒绝。
- 重复路径拒绝，比较规则与 Windows 路径兼容。
- 单文件大小限制。
- 总大小限制。
- 数量限制。
- 运行时 `.env` 和 Skill 安装保留路径拒绝。

### 从本机 Skill 目录导入

`sourceDirectoryPath` 用于从现有 Skill 目录发布：

```json
{
  "sourceDirectoryPath": "/Users/liyang/.agents/skills/api-reviewer"
}
```

行为：

- 读取主文件，沿用现有 Skill 主文件优先级。
- 主文件正文作为 `content`。
- 其他文件作为附件，保留相对路径。
- 跳过主文件、`.synapse.json`、隐藏文件、符号链接。
- 对附件做路径、大小和数量校验。
- 可从 frontmatter 提取 `name`、`title`、`description`、`category`。
- 用户显式传入的字段优先于 frontmatter。
- 缺少必填字段时返回结构化校验错误。

为避免规则分叉，应把 editor quick publish 中的目录扫描和附件快照能力拆成可复用服务，例如 `content-skill-source-service`。

## 图片图标

MCP 第一版支持图片作为内容图标，但不做交互式裁剪。

输入：

- `iconImagePath`
- `iconImageBase64`

规则：

- 两者二选一。
- 输入大小限制为 5MB。
- `iconImagePath` 读取要经过权限与路径错误处理。
- 不靠扩展名判断是否图片，以解码结果为准。
- 解码失败、非图片、过大时拒绝写入。
- 内部 center-crop 为正方形，resize 到 `256x256`，输出 PNG。
- 写入现有内容层字段：`iconType: "image"`、`iconImage: "icon.png"`、`iconImageBytes`。

图片处理应放在 main/shared 侧服务中，例如 `content-icon-image-service`。不能依赖 React 的 `ImageCropDialog`。

## 校验策略

MCP tool description 和 JSON Schema 负责告诉 Agent 如何填参；内部 dispatcher 负责强校验。

新增集中校验模块 `content-capability-validator`：

- 基础字段：抽出或复用 `normalizeContentPayload`、`validateContentPayload`。
- 分类：用 `getContentTypeDefinition(type).categories` 校验。
- 图标：用 `getContentIconOption(icon)` 校验。
- 背景色：用 `getContentColorOption(iconBg)` 校验。
- Rule name：用 `normalizeContentNameInput`、`validateContentNameInput`。
- Skill name：用 `normalizeSkillNameInput`、`validateSkillNameInput`。
- Skill 附件：复用 `normalizeContentAttachmentPath` 和抽出的附件限制常量。
- 图片图标：交给 `content-icon-image-service` 校验与处理。
- Update/Delete：统一校验 owner 与 `baseHistoryDirname`。

分类、图标、背景色、附件限制不能在 MCP schema、tool description 和 dispatcher 中重复声明。schema 描述只提示“调用 `content_type_describe` 获取可选值”。

## 错误返回

Dispatcher 应返回结构化错误，避免 Agent 从字符串里猜。

错误码：

- `validation_error`
- `not_owner`
- `conflict`
- `not_found`
- `image_error`
- `source_read_error`
- `repository_not_ready`

示例：

```json
{
  "ok": false,
  "code": "validation_error",
  "message": "内容字段校验失败。",
  "fields": {
    "category": "未知分类：foo"
  }
}
```

冲突返回应包含当前最新版本：

```json
{
  "ok": false,
  "code": "conflict",
  "message": "内容已被更新，请重新读取后再提交。",
  "latestHistoryDirname": "...",
  "latestModifiedAt": "...",
  "latestModifiedByDisplayName": "..."
}
```

## 与现有代码映射

主要复用：

- `desktop/src/config/content-types/*`
- `desktop/src/config/categories/*`
- `desktop/src/lib/content-appearance.ts`
- `desktop/src/lib/content-attachments.ts`
- `desktop/src/lib/content-name-input.ts`
- `desktop/src/lib/skill-name-input.ts`
- `desktop/electron/services/content-submission-service.ts`
- `desktop/electron/services/content-history-service.ts`
- `desktop/electron/services/editor-scan-service.ts` 中的 quick publish 目录扫描逻辑，需抽出复用

新增：

- `desktop/synapse-capabilities/shared/content-domain.ts`
- `desktop/electron/capabilities/content-dispatcher.ts`
- `desktop/electron/services/content-capability-validator.ts`
- `desktop/electron/services/content-skill-source-service.ts`
- `desktop/electron/services/content-icon-image-service.ts`
- `desktop/resources/templates/skills/synapse-content-mcp/`

需要修改：

- `desktop/synapse-capabilities/shared/registry.ts`
- `desktop/electron/capabilities/action-router.ts`
- `desktop/electron/bootstrap/descriptors.ts`
- MCP capability 相关单测与文档矩阵

## 内置 Skill

第一版只新增一个内置 Skill：`synapse-content-mcp`。

不拆成 Rule、Skill、Prompt 三个 Skill。一个 Skill 更符合用户意图：“发布内容到 Synapse”，内部再指导 Agent 选择具体工具。

Skill 内容应说明：

- 何时使用。
- 创建/更新前先调用 `content_type_describe`。
- Rule、Skill、Prompt 的字段差异。
- Skill 附件路径如何表达。
- 从已有 Skill 目录发布时使用 `sourceDirectoryPath`。
- 更新/删除前必须 `get`，使用 `latestHistoryDirname` 作为 `baseHistoryDirname`。
- 更新/删除只能操作当前用户创建的资源。
- 第一版不支持安装到编辑器。

## 测试策略

### Registry 和 MCP 工具

- `content` domain 被加入 `CAPABILITY_DOMAINS`。
- 每个 capability 能派生出正确 MCP tool。
- `content_type_describe` 返回的分类、图标、背景色来自集中定义。

### Create

- Rule、Skill、Prompt 创建成功。
- 非法分类、非法图标、非法背景色失败。
- Rule/Skill name 非法失败。
- Skill 附件路径规范化、重复路径、安装保留路径和超限失败。
- 图片图标合法输入输出 `icon.png` 和 PNG bytes。
- 非图片、损坏图片、超大图片失败。

### Update

- 缺少 `baseHistoryDirname` 失败。
- 非 owner 失败。
- 版本过期返回 `conflict`。
- Skill 不传附件时保留原附件。
- Skill 传附件或目录时整组替换附件。

### Delete

- owner 可以删除。
- 非 owner 拒绝。
- 缺少 `baseHistoryDirname` 失败。
- 版本过期返回 `conflict`。
- 不支持 `force`。

### Source Directory

- 能从已有 Skill 目录读取主文件和附件。
- 跳过隐藏文件、`.synapse.json`、符号链接。
- 运行时 `.env` 和安装保留路径拒绝。
- frontmatter 与显式字段合并规则正确。

## 推进顺序

1. 抽出共享校验和限制常量。
2. 实现 `content.type.describe`。
3. 实现 Rule/Prompt create/list/get/update/delete。
4. 实现 Skill files 输入。
5. 实现 Skill `sourceDirectoryPath` 导入。
6. 实现图片图标处理。
7. 添加内置 `synapse-content-mcp` Skill。
8. 补齐能力矩阵、MCP 文档和测试。

## 风险与取舍

- 图片处理可能需要新增依赖。实现阶段应优先确认现有依赖是否可用；没有合适依赖时再决定是否引入。
- MCP update/delete 权限比 UI 更保守，这是第一版的明确安全边界。
- `sourceDirectoryPath` 会读取用户本机文件，必须复用权限、审计、运行时 `.env` 排除和路径边界防护。
- Skill 附件第一版采用整组替换，牺牲精细编辑能力，换取简单、可解释和更少错误状态。
- `content_type_describe` 是 Agent 体验关键路径，描述必须足够清晰，但事实源只能来自现有集中定义。
