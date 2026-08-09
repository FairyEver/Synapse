<!-- Sources: desktop/src/definitions/generated/renderer-registry.ts; desktop/src/definitions/editor/; desktop/electron/services/editor-adapters/utils.ts; desktop/src/modules/content/components/editor-write-target-selector.tsx; desktop/src/types/editor.ts; docs/reference/editor-integration-matrix.md -->

# 编辑器安装

## 支持范围

Synapse 目前支持 Antigravity、Claude Code、Codex、Cursor、Hermes、Windsurf 和 WorkBuddy。WorkBuddy 仅支持 Skill；其他编辑器支持 Rule 和 Skill，具体安装范围如下。

安装前，Synapse 检查目标位置是否可用。Cursor 暂不支持全局 Rule，WorkBuddy 不支持 Rule，因此对应组合显示为“不支持”。

| 编辑器 | Rule 全局 | Rule 项目 | Skill 全局 | Skill 项目 |
| --- | --- | --- | --- | --- |
| Antigravity | 支持 | 支持 | 支持 | 支持 |
| Claude Code | 支持 | 支持 | 支持 | 支持 |
| Codex | 支持 | 支持 | 支持 | 支持 |
| Cursor | 不支持 | 支持 | 支持 | 支持 |
| Hermes | 支持 | 支持 | 支持 | 支持 |
| Windsurf | 支持 | 支持 | 支持 | 支持 |
| WorkBuddy | 不支持 | 不支持 | 支持 | 支持 |

安装路径支持 macOS、Linux 和 Windows。其他系统显示为“不支持”。

## 全局安装

全局安装写入对应编辑器的用户目录。

| 编辑器 | Rule | Skill |
| --- | --- | --- |
| Antigravity | `~/.gemini/GEMINI.md` | `~/.gemini/antigravity/skills/{skillName}/` |
| Claude Code | `~/.claude/rules/{name}.md` | `~/.claude/skills/{skillName}/` |
| Codex | `$CODEX_HOME/AGENTS.md`，未设置时为 `~/.codex/AGENTS.md` | `~/.agents/skills/{skillName}/` |
| Cursor | 不支持 | `~/.cursor/skills/{skillName}/` |
| Hermes | `$HERMES_HOME/SOUL.md`，未设置时为 `~/.hermes/SOUL.md` | `$HERMES_HOME/skills/{skillName}/`，未设置时为 `~/.hermes/skills/{skillName}/` |
| Windsurf | `~/.codeium/windsurf/memories/global_rules.md` | `~/.codeium/windsurf/skills/{skillName}/` |
| WorkBuddy | 不支持 | `~/.workbuddy/skills/{skillName}/` |

Antigravity、Codex 和 Windsurf 的全局 Rule，以及 Hermes 的 Rule，写入目标文件中的 Synapse 标记区块。Skill 全局安装写入目录。

## 项目级安装

项目级安装写入所选项目目录。安装对话框可选择设置中保存的项目，也可浏览其他目录。

| 编辑器 | Rule | Skill |
| --- | --- | --- |
| Antigravity | `{projectPath}/.agents/rules/{name}.md` | `{projectPath}/.agents/skills/{skillName}/` |
| Claude Code | `{projectPath}/.claude/rules/{name}.md` | `{projectPath}/.claude/skills/{skillName}/` |
| Codex | `{projectPath}/AGENTS.md` | `{projectPath}/.agents/skills/{skillName}/` |
| Cursor | `{projectPath}/.cursor/rules/{name}.mdc` | `{projectPath}/.cursor/skills/{skillName}/` |
| Hermes | `{projectPath}/.hermes.md` | `{projectPath}/.hermes/skills/{skillName}/` |
| Windsurf | `{projectPath}/.windsurf/rules/{name}.md` | `{projectPath}/.windsurf/skills/{skillName}/` |
| WorkBuddy | 不支持 | `{projectPath}/.workbuddy/skills/{skillName}/` |

安装项目级 Rule 时，部分编辑器需要补充以下信息：

| 编辑器 | 需要填写的信息 |
| --- | --- |
| Cursor | `description`、`globs`、`alwaysApply` |
| Claude Code | `paths` |
| Windsurf | `trigger`，以及按触发模式使用的 `description` 或 `globs` |

Codex 项目级 Rule 无需填写额外信息。

## 安装状态

安装前，Synapse 检查目标位置。状态包括：

| 状态 | 含义 |
| --- | --- |
| 可安装 | 支持写入目标文件或目录 |
| 不支持 | 目前编辑器或当前组合不支持 |
| 不可用 | 缺少编辑器用户目录，或项目路径不存在 |
| 冲突 | Skill 目标位置已有同名目录，需要确认替换 |

安装面板显示目标位置。文件目标提示“将写入单个文件”，目录目标提示“将写入目录”。

## 路径参考

`{name}` 为 Rule 的名称。未设置名称时，Synapse 使用自动生成的规则名。

`{skillName}` 为 Skill 的名称。未设置名称时，Synapse 根据标题生成目录名；仍无法生成时，使用内容 ID。

`{projectPath}` 为安装时选择的项目目录。项目路径不存在时，安装目标显示为不可用。
