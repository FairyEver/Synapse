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

Synapse 把仓库里的两种内容 —— **规则（Rule）** 和 **技能（Skill）** —— 按各编辑器的官方约定写入到本地磁盘上对应的位置，由编辑器自身负责后续加载。本节说明每种编辑器被"安装"时发生了什么。

### 一、支持的编辑器

| 编辑器 ID | 名称 | 支持范围 | 支持内容 | 适配器实现 |
| --- | --- | --- | --- | --- |
| `cursor` | Cursor | 全局 / 项目 | 规则、技能 | [electron/services/editor-adapters/cursor-adapter.ts](electron/services/editor-adapters/cursor-adapter.ts) |
| `codex` | Codex | 全局 / 项目 | 规则、技能 | [electron/services/editor-adapters/codex-adapter.ts](electron/services/editor-adapters/codex-adapter.ts) |
| `claude-code` | Claude Code | 全局 / 项目 | 规则、技能 | [electron/services/editor-adapters/claude-code-adapter.ts](electron/services/editor-adapters/claude-code-adapter.ts) |

平台支持：macOS / Linux / Windows（见 [utils.ts](electron/services/editor-adapters/utils.ts) 的 `isSupportedEditorPlatform`）。

编辑器存储路径的权威来源：[document/不同编辑器存储规则.md](document/不同编辑器存储规则.md)。

### 二、安装目标路径

下表中 `{contentId}` 为内容的 UUID（去掉 `-`），`{projectPath}` 为用户在 Synapse 中选中的项目本地路径。

#### Claude Code

| 类型 | 范围 | 目标路径 | 目标类型 |
| --- | --- | --- | --- |
| 规则 | 全局 | `~/.claude/CLAUDE.md` | 文件 |
| 规则 | 项目 | `{projectPath}/CLAUDE.md` | 文件 |
| 技能 | 全局 | `~/.claude/skills/{contentId}/` | 目录 |
| 技能 | 项目 | `{projectPath}/.claude/skills/{contentId}/` | 目录 |

前置条件：全局安装要求 `~/.claude/` 已存在；项目安装要求 `projectPath` 已存在。

#### Codex

| 类型 | 范围 | 目标路径 | 目标类型 |
| --- | --- | --- | --- |
| 规则 | 全局 | `$CODEX_HOME/AGENTS.md`，未设置则为 `~/.codex/AGENTS.md` | 文件 |
| 规则 | 项目 | `{projectPath}/AGENTS.md` | 文件 |
| 技能 | 全局 | `~/.agents/skills/{contentId}/` | 目录 |
| 技能 | 项目 | `{projectPath}/.agents/skills/{contentId}/` | 目录 |

注意：Codex 全局技能落到 `~/.agents`，与规则所在的 `~/.codex` 不是同一个目录（参见 [codex-adapter.ts:67](electron/services/editor-adapters/codex-adapter.ts#L67)）。

#### Cursor

| 类型 | 范围 | 目标路径 | 目标类型 |
| --- | --- | --- | --- |
| 规则 | 全局 | 不支持 | — |
| 规则 | 项目 | `{projectPath}/.cursor/rules/{contentId}.md` | 文件 |
| 技能 | 全局 | `~/.cursor/skills/{contentId}/` | 目录 |
| 技能 | 项目 | `{projectPath}/.cursor/skills/{contentId}/` | 目录 |

Cursor 全局规则返回 `unsupported` 状态（[cursor-adapter.ts:32-39](electron/services/editor-adapters/cursor-adapter.ts#L32-L39)）：官方文档未公布固定的全局规则磁盘路径，规则仅可通过 Cursor 设置界面管理。

### 三、规则与技能的写入形式

两种内容在内部都以 `main.md` + 可选附件的形式存储在仓库里（见 [electron/services/content-history-service.ts](electron/services/content-history-service.ts)）。写到编辑器时按类型拆成两种策略：

#### 规则（single-file）

- 只写一个 Markdown 文件
- 内容 = 仓库中该版本的 `main.md` 原文
- 目标文件名依编辑器不同：Claude Code 为 `CLAUDE.md`，Codex 为 `AGENTS.md`，Cursor 为 `{contentId}.md`
- 写入逻辑：[content-install-service.ts:160-167](electron/services/content-install-service.ts#L160-L167) → `replaceFileAtomically()`（先写临时文件再原子替换）

#### 技能（directory-overwrite）

- 写一个完整目录
- 目录内容：`SKILL.md`（由仓库中的 `main.md` 改名而来）+ 全部附件（保留原始文件名）
- 写入逻辑：[content-install-service.ts:169-191](electron/services/content-install-service.ts#L169-L191) → `replaceDirectoryAtomically()`
- 原子性保证：先在临时暂存目录写全部文件，再通过 `swapPathAtomically()` 备份旧目录 → 移入新目录 → 删除备份；任一步骤失败都会回滚备份，避免"半坏"状态（见 [content-install-service.ts:63-96](electron/services/content-install-service.ts#L63-L96)）

### 四、安装流程（从 UI 到磁盘）

```
UI 安装对话框 (src/modules/content/components/content-install-dialog.tsx)
  │
  ├─ getEditorAdapters()  列出适配器
  │   IPC: synapse:content:get-editor-adapters
  │   → EditorAdapterService.listAdapters()
  │
  ├─ resolveEditorInstallTarget({ editorId, scope, contentType, contentId, projectPath? })
  │   IPC: synapse:content:resolve-editor-install-target
  │   → adapter.resolveGlobalTarget() | adapter.resolveProjectTarget()
  │   返回三态：ready | unsupported | unavailable
  │
  └─ installToEditor(payload)
      IPC: synapse:content:install-to-editor
      → ContentInstallService.installToEditor()
      → 按 install.kind 分流：single-file 或 directory-overwrite
      → 原子写入磁盘
```

IPC 通道常量：[electron/ipc/channels.ts](electron/ipc/channels.ts)
IPC 处理函数：[electron/ipc/content-handlers.ts](electron/ipc/content-handlers.ts)

### 五、目标路径解析的三种状态

适配器解析目标时返回以下三种之一（定义见 [src/types/editor.ts](src/types/editor.ts)）：

| 状态 | 含义 | 典型场景 |
| --- | --- | --- |
| `ready` | 路径可用，可以直接安装 | 编辑器用户目录和项目路径都存在 |
| `unsupported` | 该编辑器/内容/范围组合不被支持 | Cursor 的全局规则 |
| `unavailable` | 编辑器未安装，或路径当前不存在 | `~/.claude` 不存在；`projectPath` 不存在 |

UI 根据状态决定是禁用按钮、提示用户安装编辑器，还是允许继续。

### 六、内容类型在配置层的声明

安装时的行为差异由 [src/config/content-types/](src/config/content-types/) 下的内容类型定义驱动：

| 字段 | 规则 | 技能 |
| --- | --- | --- |
| `install.kind` | `single-file` | `directory-overwrite` |
| `hasAttachments` | `false` | `true` |
| `canInstallToEditor` | `true` | `true` |

新增一种内容类型只需在此目录添加定义；新增一种编辑器只需在 [electron/services/editor-adapters/](electron/services/editor-adapters/) 添加一个适配器并在 [index.ts](electron/services/editor-adapters/index.ts) 注册，UI 层无需改动。
