# Hermes Agent 集成设计

## 概述

为 Synapse 新增 Hermes Agent 支持，包含三个维度：
- **Editor 适配**：MCP 注册 + Rules 安装 + Skills 安装
- **Agent 适配**：对话执行 + 定时任务调度

Hermes 是 Nous Research 开发的开源 AI Agent，支持 CLI / TUI / Gateway（Telegram/Discord/Slack/WeChat）多平台运行，具备 MCP、Skills、Cron、持久记忆等能力。

## 架构决策

### 双注册模式

Hermes 同时注册为 editor 和 agent（与 Claude Code / Codex 相同模式）：
- `src/definitions/editor/hermes/` — 负责 MCP 注册和内容安装
- `src/definitions/agent/hermes/` — 负责对话和定时任务

### 不引入新分类

不新增第三类"AI Agent Platform"分类。现有 editor + agent 两层架构已足够，Hermes 复用 Claude Code/Codex 的注册模式。

---

## Editor 适配

### MCP 注册

| 字段 | 值 |
|------|---|
| target | `"hermes"` |
| label | `"Hermes"` |
| settingsFormat | `"hermes-yaml"`（新增格式） |
| settingsPathSegments | `[".hermes", "config.yaml"]` |

写入内容：
```yaml
mcp_servers:
  synapse:
    url: "http://127.0.0.1:{mcpPort}/mcp"
```

`mcp-installer.ts` 新增 YAML 格式处理：
- 读取：解析 YAML，检查 `mcp_servers.synapse` 是否存在
- 写入：保留已有配置，在 `mcp_servers` 键下添加/更新 `synapse` 条目
- 删除：移除 `mcp_servers.synapse` 条目

依赖：需引入 YAML 解析库（`yaml` npm 包，或复用项目已有的）。

### Rules 安装

#### 全局 Rules → `~/.hermes/SOUL.md`

- 追加到文件末尾，用标记包裹：
```markdown

<!-- synapse:rule:{ruleId} -->
## {Rule Title}
{Rule content}
<!-- /synapse:rule:{ruleId} -->
```
- 卸载时通过标记精确定位并删除对应段落
- 无 frontmatter（SOUL.md 是纯 Markdown，Hermes verbatim 注入到 system prompt）
- UI 警告："此规则将追加到 ~/.hermes/SOUL.md（Hermes 人格文件）。SOUL.md 超过 20,000 字符会被截断。"

#### 项目级 Rules → `.hermes.md`

- 写入项目根目录的 `.hermes.md`（Hermes 最高优先级 context file）
- 同样用标记包裹，支持多条 rule 共存
- 如果 `.hermes.md` 已存在，追加到末尾
- 如果不存在，创建新文件

### Skills 安装

#### 目标路径

`~/.hermes/skills/{skill-name}/`

目录结构：
```
~/.hermes/skills/{skill-name}/
├── SKILL.md              # 主文件（YAML frontmatter + Markdown）
├── .synapse.json         # Synapse 追踪文件
├── references/           # 参考资料，存在时保留
├── templates/            # 模板，存在时保留
├── scripts/              # 脚本，存在时保留
└── assets/               # 资源，存在时保留
```

#### 标准格式

Hermes 与 Antigravity、Claude Code、Codex、Cursor 和 Windsurf 使用同一标准 Skill 格式。安装时复用公共 Skill 目录写入器，不进行 Hermes 专属 frontmatter 转换，也不重排附件路径。

`metadata.hermes`、`version` 等字段是可选扩展，不构成独立格式，Synapse 不强制生成。Skill 自带的 `references/`、`templates/`、`scripts/`、`assets/` 及其他附件保持原相对路径。

---

## Agent 适配

### Agent 定义

```typescript
// src/definitions/agent/hermes/agent-shared.ts
{
  id: "hermes",
  label: "Hermes",
  order: 30,
  relatedEditorId: "hermes",
  runtime: {
    kind: "local-cli",
    binaries: ["hermes"]
  },
  modes: [
    { id: "default", label: "Default", unattended: false },
    { id: "yolo", label: "YOLO", unattended: true }
  ],
  commands: [
    { id: "model", label: "/model" },
    { id: "skills", label: "/skills" },
    { id: "cron", label: "/cron" }
  ],
  capabilities: { ... }
}
```

### Adapter 实现

`electron/services/agent-runtime/adapters/hermes.ts`

Hermes 没有 Claude Code 的 stream-json 协议，采用"黑盒执行"模式：

#### 执行方式

```bash
hermes -z "{prompt}" --quiet --ignore-rules
```

- `-z`：纯净单次执行，只返回最终结果文本
- `--quiet`：抑制 banner/spinner/tool preview
- `--ignore-rules`：可选，避免加载用户本地规则干扰

#### Adapter 接口实现

```typescript
class HermesAdapter implements AgentAdapter {
  agentType = "hermes"

  async execute(message, context): Promise<AgentExecuteResult> {
    // 构建命令：hermes -z "prompt" [flags]
    // spawn 进程，收集 stdout
    // 返回最终文本结果
  }

  // 不支持 startSession — Hermes 没有结构化流式协议
  // startSession = undefined
}
```

#### 限制

- 无实时流式事件（不能展示中间工具调用过程）
- 无权限审批交互（Hermes 自主决策或 --yolo）
- 只能获取最终结果文本

### 定时任务

通过 Synapse scheduler 的 `builtin.agent` action 调度：

```typescript
{
  type: "builtin.agent",
  config: {
    agentType: "hermes",
    mode: "yolo",           // unattended 模式
    prompt: "...",
    sessionPolicy: "fresh", // 每次新 session
    timeoutMins: 30
  }
}
```

执行时 spawn `hermes -z "{prompt}" --quiet`，收集输出作为结果。

---

## 新增文件清单

### Editor 侧

| 文件 | 用途 |
|------|------|
| `src/definitions/editor/hermes/editor.ts` | Editor 定义（id, label, order, 支持的内容类型） |
| `src/definitions/editor/hermes/adapter.ts` | EditorAdapter 实现（路径解析） |
| `src/definitions/editor/hermes/install.ts` | EditorInstallStrategy 实现（内容转换） |
| `src/definitions/editor/hermes/scan.ts` | EditorScanStrategy 实现（扫描已安装内容） |
| `src/definitions/editor/hermes/mcp.ts` | MCP 定义（YAML 格式） |
| `src/definitions/editor/hermes/forms.tsx` | 安装面板组件（category, tags, version） |
| `src/definitions/editor/hermes/frontmatter.ts` | SKILL.md frontmatter 序列化/反序列化 |

### Agent 侧

| 文件 | 用途 |
|------|------|
| `src/definitions/agent/hermes/agent.ts` | Agent 定义（icon 导出） |
| `src/definitions/agent/hermes/agent-shared.ts` | Agent 基础定义（modes, commands, capabilities） |
| `src/definitions/agent/hermes/agent-main.ts` | AgentRuntimeDefinition（createAdapter, buildEnv） |
| `electron/services/agent-runtime/adapters/hermes.ts` | HermesAdapter 实现 |

### 核心修改

| 文件 | 修改内容 |
|------|---------|
| `electron/database/mcp-installer.ts` | 新增 `hermes-yaml` 格式的注册/检测/卸载逻辑 |
| `src/definitions/types.ts` | `SynapseMcpSettingsFormat` 类型新增 `"hermes-yaml"` |

Registry 文件（`main-registry.ts`, `renderer-registry.ts`）由构建脚本自动生成，无需手动修改。

---

## 依赖

- `yaml` npm 包（YAML 解析/序列化，用于 config.yaml 读写）
- Hermes CLI 已安装在用户 PATH 中（`which hermes` 可找到）

---

## 不做的事

- 不支持 `external_dirs` 配置方式安装 skills
- 不引入第三类"AI Agent Platform"分类
- 不实现实时流式事件展示（Hermes 无此协议）
- 不实现权限审批交互（Hermes 自主决策）
- Agent adapter 不实现 `startSession()`（无 live session 支持）
