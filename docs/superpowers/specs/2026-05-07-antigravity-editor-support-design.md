# Antigravity Editor Support Design

## Overview

为 Synapse 新增 Google Antigravity 编辑器适配，使用户可以将 rules 和 skills 安装到 Antigravity，并管理其 MCP 配置。

## 背景

Antigravity 是 Google 于 2025 年 11 月发布的 agent-first IDE，基于 VS Code 深度定制，搭载 Gemini 3 模型。它支持 rules（项目规则）和 skills（可复用工作流）两种内容类型，同时支持 MCP 协议。

官方文档来源：
- [Google Codelabs - Getting Started](https://codelabs.developers.google.com/getting-started-google-antigravity)
- [GitHub Issue #16058 - GEMINI.md 路径](https://github.com/google-gemini/gemini-cli/issues/16058)
- [Google AI Forum - .agents/ 路径确认](https://discuss.ai.google.dev/t/new-folder-for-rules/126165)
- [Devopness MCP 文档](https://devopness.com/docs/docs/mcp/antigravity/)
- [Agent Skills 介绍](https://www.juheapi.com/blog/google-antigravity-has-introduced-agent-skills)

## 路径规范

| 类型 | 路径 | 说明 |
|------|------|------|
| 检测目录 | `~/.gemini/antigravity/` | 判断 Antigravity 是否已安装 |
| 全局 rules | `~/.gemini/GEMINI.md` | 单文件，section 追加模式 |
| 全局 skills | `~/.gemini/antigravity/skills/<slug>/` | 目录，标准 skill 结构 |
| 项目 rules | `<project>/.agents/rules/<name>.md` | 独立文件，纯 markdown |
| 项目 skills | `<project>/.agents/skills/<slug>/` | 目录，标准 skill 结构 |
| MCP 配置 | `~/.gemini/antigravity/mcp_config.json` | json-mcp-servers 格式 |

## 文件结构

```
src/definitions/editor/antigravity/
├── icon.png
├── editor.ts
├── adapter.ts
├── install.ts
├── scan.ts
└── mcp.ts
```

不需要 `forms.tsx`（无安装表单）和 `frontmatter.ts`（rules 无 frontmatter）。

## 组件设计

### editor.ts

```ts
export const editorDefinition = {
  id: "antigravity",
  label: "Antigravity",
  order: 50,
  icon: antigravityIcon,
  supportsGlobal: true,
  supportsProject: true,
  supportedContentTypes: ["rule", "skill"],
} as const satisfies SynapseEditorDefinition
```

### adapter.ts

实现 `EditorAdapter` 接口：

- `resolveGlobalDirectoryPaths()` — 返回 `~/.gemini/GEMINI.md`（rules）和 `~/.gemini/antigravity/skills/`（skills）
- `resolveGlobalTarget()` — 检测 `~/.gemini/antigravity/` 是否存在；rules 返回单文件 target，skills 走 slug + conflict 检测
- `resolveProjectTarget()` — rules 返回 `.agents/rules/<name>.md`，skills 返回 `.agents/skills/<slug>/`
- `getScanPathConfig()` — 提供全局和项目级的扫描路径

### install.ts

实现 `EditorInstallStrategy` 接口：

- `prepareRuleFileContent()`:
  - 全局 scope：使用 `applyRuleSection(existing, contentId, ruleBody)` 追加 section
  - 项目 scope：直接返回 `ruleBody`（纯 markdown，无 frontmatter）
- `prepareSkillDirectory()`: 使用 `writeSynapseSkillDirectory(context)`

### scan.ts

实现 `EditorScanStrategy` 接口：

- `scanRules(rulesPath)`:
  - 如果路径是文件（全局 `GEMINI.md`）→ 使用 `scanCodexRules`（section 解析）
  - 如果路径是目录（项目 `.agents/rules/`）→ 使用 `scanClaudeCodeRules`（目录扫描）

### mcp.ts

```ts
export const mcpDefinition = {
  target: "antigravity",
  label: "Antigravity",
  order: 50,
  settingsPathSegments: [".gemini", "antigravity", "mcp_config.json"],
  settingsFormat: "json-mcp-servers",
} as const satisfies SynapseMcpDefinition
```

## Registry 注册

### renderer-registry.ts

- `editorDefinitions` 数组添加 `antigravityEditorDefinition`
- `mcpDefinitions` 数组添加 `antigravityMcpDefinition`（带 icon）
- 不需要加入 `installFormDefinitionByEditorId`

### main-registry.ts

- `editorAdapters` 数组添加 `antigravityEditorAdapter`
- `mcpDefinitions` 数组添加 `antigravityMcpDefinition`
- `editorInstallStrategyById` Map 添加 antigravity 条目
- `editorScanStrategyById` Map 添加 antigravity 条目

## 复用的 shared 模块

| 模块 | 用途 |
|------|------|
| `shared-rule-section.ts` | 全局 rules 的 section 追加/更新 |
| `shared-skill-directory.ts` | skill 目录写入 |
| `shared-rule-scanners.ts` | `scanClaudeCodeRules`（目录）+ `scanCodexRules`（单文件） |
| `editor-adapters/utils.ts` | 路径工具函数 |
| `editor-adapters/skill-slug.ts` | slug 解析 |
| `editor-adapters/skill-identity.ts` | conflict 检测 |

## 不涉及的范围

- Agent runtime 适配（Antigravity 不作为 Synapse 的 agent 运行时）
- Workflows 支持（Synapse 当前不管理 workflows 类型）
- `.agents/` vs `.agent/` 兼容（只使用官方推荐的 `.agents/`）
