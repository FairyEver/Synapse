# Synapse

Where Ideas Connect

## 下载

[github releases](https://github.com/FairyEver/Synapse/releases)

## 常见问题

提示已损坏

```
sudo xattr -dr com.apple.quarantine /Applications/Synapse.app
```

---

## 编辑器集成说明

Synapse 把仓库里的 **规则（Rule）** 和 **技能（Skill）** 按各编辑器的官方约定，写入到本地磁盘上对应的位置，由编辑器自身加载使用。

### 支持的编辑器

| 编辑器 | 支持范围 | 支持内容 |
| --- | --- | --- |
| Claude Code | 全局 / 项目 | 规则、技能 |
| Codex | 全局 / 项目 | 规则、技能 |
| Cursor | 全局（仅技能） / 项目 | 规则、技能 |

平台支持：macOS、Linux、Windows。

### 安装路径

下表中 `{contentId}` 为内容的唯一 ID，`{projectPath}` 为你在 Synapse 中选中的项目目录。

#### Claude Code

| 类型 | 范围 | 目标路径 |
| --- | --- | --- |
| 规则 | 全局 | `~/.claude/CLAUDE.md` |
| 规则 | 项目 | `{projectPath}/.claude/rules/{name}.md` |
| 技能 | 全局 | `~/.claude/skills/{contentId}/` |
| 技能 | 项目 | `{projectPath}/.claude/skills/{contentId}/` |

项目规则以独立 `.md` 文件写入 `.claude/rules/` 目录，文件名取规则的 `name` 字段。如果规则尚未设置名称，则自动使用 `synapse_{contentId}` 作为文件名。安装时可选填 `paths` frontmatter，限定规则仅在匹配文件进入 context 时加载。

#### Codex

| 类型 | 范围 | 目标路径 |
| --- | --- | --- |
| 规则 | 全局 | `$CODEX_HOME/AGENTS.md`，未设置则为 `~/.codex/AGENTS.md` |
| 规则 | 项目 | `{projectPath}/AGENTS.md` |
| 技能 | 全局 | `~/.agents/skills/{contentId}/` |
| 技能 | 项目 | `{projectPath}/.agents/skills/{contentId}/` |

注意：Codex 全局技能写到 `~/.agents`，而不是 `~/.codex`。

#### Cursor

| 类型 | 范围 | 目标路径 |
| --- | --- | --- |
| 规则 | 全局 | 不支持（Cursor 全局规则只能通过其设置界面管理） |
| 规则 | 项目 | `{projectPath}/.cursor/rules/{contentId}.mdc` |
| 技能 | 全局 | `~/.cursor/skills/{contentId}/` |
| 技能 | 项目 | `{projectPath}/.cursor/skills/{contentId}/` |

### 规则与技能的写入形式

- **规则**：写入单个 Markdown 文件。Claude Code 项目规则写入 `.claude/rules/{name}.md`（独立文件，支持可选的 `paths` frontmatter）；Claude Code 全局规则和 Codex 规则合并写入 `CLAUDE.md` / `AGENTS.md`（用 HTML 注释标记分隔）；Cursor 规则写入 `{contentId}.mdc`（Cursor 原生 MDC 规则格式）。
- **技能**：写入一个完整目录，目录中包含 `SKILL.md` 主文件和全部附件（附件保留原文件名）。

所有写入都是原子操作：新内容先写入临时位置，就绪后再整体替换目标；失败会自动回滚，不会留下半坏的文件或目录。

### 安装状态

点击安装时，每个编辑器会先检查路径能否用，分三种结果：

| 状态 | 含义 |
| --- | --- |
| 就绪 | 路径可用，可以直接安装 |
| 不支持 | 该编辑器不支持这种组合（例如 Cursor 全局规则） |
| 不可用 | 编辑器未安装，或项目路径不存在 |

UI 会根据状态启用或禁用安装按钮，并给出相应提示。
