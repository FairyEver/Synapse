<!-- Sources: desktop/src/definitions/editor/claude-code/editor.ts; desktop/src/definitions/editor/claude-code/adapter.ts; desktop/src/definitions/editor/claude-code/install.ts; desktop/src/definitions/editor/claude-code/forms.tsx; desktop/src/definitions/editor/codex/editor.ts; desktop/src/definitions/editor/codex/adapter.ts; desktop/src/definitions/editor/codex/install.ts; desktop/src/definitions/editor/cursor/editor.ts; desktop/src/definitions/editor/cursor/adapter.ts; desktop/src/definitions/editor/cursor/install.ts; desktop/src/definitions/editor/cursor/forms.tsx; desktop/src/definitions/editor/windsurf/editor.ts; desktop/src/definitions/editor/windsurf/adapter.ts; desktop/src/definitions/editor/windsurf/install.ts; desktop/src/definitions/editor/windsurf/forms.tsx; desktop/electron/services/editor-adapters/utils.ts; desktop/src/modules/content/components/editor-write-target-selector.tsx; desktop/src/types/editor.ts -->

# 编辑器安装

## 支持范围

当前代码定义了 4 个编辑器：Cursor、Codex、Claude Code、Windsurf。四者都声明支持 Rule 和 Skill，也都声明支持全局和项目范围。

实际安装时，目标解析还会返回更细的状态。Cursor 全局 Rule 当前返回“不支持”，因为代码中没有固定的 Cursor 全局 Rule 磁盘路径。

| 编辑器 | Rule 全局 | Rule 项目 | Skill 全局 | Skill 项目 |
| --- | --- | --- | --- | --- |
| Cursor | 不支持 | 支持 | 支持 | 支持 |
| Codex | 支持 | 支持 | 支持 | 支持 |
| Claude Code | 支持 | 支持 | 支持 | 支持 |
| Windsurf | 支持 | 支持 | 支持 | 支持 |

路径解析支持 macOS、Linux 和 Windows。其他系统会返回“不支持”。

## 全局安装

全局安装写入编辑器的用户目录。目标位置由编辑器定义解析。

| 编辑器 | Rule | Skill |
| --- | --- | --- |
| Cursor | 不支持 | `~/.cursor/skills/{skillName}/` |
| Codex | `$CODEX_HOME/AGENTS.md`，未设置时为 `~/.codex/AGENTS.md` | `~/.agents/skills/{skillName}/` |
| Claude Code | `~/.claude/rules/{name}.md` | `~/.claude/skills/{skillName}/` |
| Windsurf | `~/.codeium/windsurf/memories/global_rules.md` | `~/.codeium/windsurf/skills/{skillName}/` |

Codex 全局 Rule 和 Windsurf 全局 Rule 会写入已有文件中的 Synapse 标记区块。Skill 全局安装会写入目录。

## 项目级安装

项目级安装写入所选项目目录。安装对话框可以选择设置中保存的项目，也可以浏览其他目录。

| 编辑器 | Rule | Skill |
| --- | --- | --- |
| Cursor | `{projectPath}/.cursor/rules/{name}.mdc` | `{projectPath}/.cursor/skills/{skillName}/` |
| Codex | `{projectPath}/AGENTS.md` | `{projectPath}/.agents/skills/{skillName}/` |
| Claude Code | `{projectPath}/.claude/rules/{name}.md` | `{projectPath}/.claude/skills/{skillName}/` |
| Windsurf | `{projectPath}/.windsurf/rules/{name}.md` | `{projectPath}/.windsurf/skills/{skillName}/` |

项目 Rule 安装可能需要补充编辑器元数据：

| 编辑器 | 元数据 |
| --- | --- |
| Cursor | `description`、`globs`、`alwaysApply` |
| Claude Code | `paths` |
| Windsurf | `trigger`，以及按触发模式使用的 `description` 或 `globs` |

Codex 项目 Rule 不显示额外元数据表单。

## 安装状态

安装前会解析目标位置。目标状态包括：

| 状态 | 含义 |
| --- | --- |
| `ready` | 可以写入目标文件或目录 |
| `unsupported` | 当前编辑器或当前组合不支持 |
| `unavailable` | 缺少编辑器用户目录，或项目路径不存在 |
| `conflict` | Skill 目标位置已有同名目录，需要确认替换 |

安装面板会显示目标位置。文件目标提示“将写入单个文件”，目录目标提示“将写入目录”。

## 路径参考

`{name}` 来自 Rule 的名称字段。若部分编辑器需要兜底，代码会使用 Synapse 生成的规则名。

`{skillName}` 来自 Skill 的名称字段；如果旧数据没有名称，会回退到标题生成的 slug，再回退到内容 ID。

`{projectPath}` 是安装时选择的项目目录。项目路径不存在时，目标解析会返回不可用。
