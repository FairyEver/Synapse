# 能力注册清单

本文件记录 Synapse 当前运行时代码的真实产品表面。声明文件、目录名、测试夹具或计划文档不能单独作为“已注册”的证据。

## 注册表面与权威入口

| 注册表面 | 决定内容 | 权威入口 |
|---|---|---|
| System App | 应用身份、独立窗口、启动器入口、条件可见性 | `desktop/src/modules/apps/types.ts`、`definitions.ts`、`registry.ts`、`visibility.ts`、`components/system-app-content.tsx` |
| Dock | 默认固定、用户可固定、条件显示 | 各 App 的 `app-definition.ts` 中 `dock` 元数据、`desktop/src/modules/apps/dock.ts` |
| Workflow Node | 节点类型、Renderer manifest、Main executor | `desktop/workflow-nodes/register.renderer.ts`、`register.main.ts` |
| Automation Action | 动作类型、Renderer 配置、Main executor | `desktop/src/action-runtime/builtin-actions.ts`、`desktop/electron/action-runtime/builtin-actions.ts` |
| MCP Capability / Tool | capability catalog、`tools/list`、tool 到 action 映射 | `desktop/synapse-capabilities/shared/registry.ts` 及各 domain registry |
| Deep Link | `synapse://app/<app-id>/<action>` | `desktop/app-capabilities/manifest-registry.ts`、`desktop/electron/bootstrap/app-deep-link.ts` |

## `desktop/app-capabilities` 产品表面

“应用页=否”表示不存在 System App 身份、启动器、Dock 或独立应用窗口。数字为注册数量，`—` 表示没有该表面。

| 能力包 | 应用页 | 默认 Dock | Workflow | Automation | MCP | Deep Link |
|---|---:|---:|---:|---:|---:|---:|
| Agent Personas | 是 | 否 | — | — | — | — |
| Connectors | 是 | 否 | — | — | — | — |
| Clipboard | 否 | 否 | 2 | — | — | — |
| Document Template | 否 | 否 | 1 | — | 1 | — |
| File Opener | 否 | 否 | 1 | — | 1 | `open` |
| HTML Generator | 否 | 否 | 2 | — | 2 | — |
| JavaScript Run | 否 | 否 | 1 | 1 | — | — |
| JSON Repair | 否 | 否 | 1 | — | 1 | — |
| Node.js Run | 否 | 否 | 1 | 1 | — | — |
| Problem Feedback | 否 | 否 | — | — | 1 | — |
| Quick Input | 是 | 否 | — | — | — | — |
| Rule Installer | 否 | 否 | — | — | — | — |
| Secrets | 是 | 否 | — | — | 6 | — |
| Skill Installer | 否 | 否 | — | — | — | — |
| Skill Uninstaller | 否 | 否 | — | — | — | — |
| Sound Notifier | 否 | 否 | — | — | 1 | — |
| Synapse Skill | 是 | 否 | — | — | — | — |
| System Notifier | 否 | 否 | 1 | — | 1 | — |
| Terminal | 是 | 是 | — | — | 43 | — |
| Text Extractor | 否 | 否 | 1 | — | 2 | — |
| Text File Writer | 否 | 否 | 1 | — | 1 | — |
| Script Runtime | 否 | 否 | — | — | — | — |
| Screenshot | 否 | 否 | — | — | — | — |

固定例外：

- JavaScript Run、Node.js Run 是能力包，不是隐藏的 System App；它们只注册 Workflow Node 和 Automation Action。它们的 capability ID 进入 catalog，但不映射为 MCP tool。
- Script Runtime 是两者共用的内部执行基础设施，不注册用户产品表面。
- Screenshot 当前是空目录占位。
- `figma-skill` 是随桌面端打包的 Agent SDK Skill 插件，不注册独立 System App、MCP domain 或 MCP tool；由 Figma 内置连接器定义声明，并仅在该连接器启用后创建的新对话中按会话快照加载。
- Workflow/Automation 的 `discovery: "visible" | "hidden"` 只控制创建选择器；`hidden` 不注销类型，已有配置仍可加载和执行。
- System App 的 `visibility` 控制启动器和 Dock 条件入口。未注册 System App 的能力包不得进入 `SYSTEM_APP_IDS`、definitions/registry、内容宿主或应用窗口 IPC。
- Terminal 的 43 个 MCP 工具包含 `global_launch.get/update`；环境变量值只存在于加密 body，MCP 只返回键、动作、来源和 revision。
- Agent 已配置项目可通过现有 Terminal UI IPC 在项目目录新建会话，并以仅含 `sessionId` 的 System App 请求打开或聚焦 Terminal；该入口不新增 MCP capability、tool 或 Deep Link。
- Terminal 分屏 workspace/pane 仅属于现有 System App 的 UI IPC：创建、调整与拖拽重排 pane 时，每个 pane 仍由一个既有 session 承载，因此 MCP 工具数量保持 43，不注册 workspace/pane MCP capability、tool 或 Deep Link。
- Agent 对话与 Terminal pane 的工作目录文件树只通过受权限与审计保护的 UI 私有 IPC 读取和监听；Agent 使用项目目录，Terminal 优先使用 OSC 7 报告的实时目录并回退到会话启动目录。该入口不注册 MCP capability、tool 或 Deep Link，Terminal MCP 工具数量保持 43。
- Terminal 图片剪贴板落盘仅属于现有 System App 的 UI 私有 IPC，用于把临时 PNG 路径交给当前 PTY；不注册 MCP capability、tool 或 Deep Link，Terminal MCP 工具数量保持 43。

## 普通业务模块 System App

| System App | 应用页 | 默认 Dock | 关联 MCP domain |
|---|---:|---:|---|
| Agent | 是 | 是 | — |
| Workflow | 条件显示 | 条件显示 | `workflow` |
| Drive | 是 | 是 | `drive` |
| Automation | 是 | 是 | `automation` |
| Launcher | 自身即应用页 | 是且不可移除 | — |
| Settings | 是 | 是 | `repository` |
| Resource Repository | 是 | 否 | `content`、`skill_repository` |
| Git | 是 | 否 | — |
| Database | 是 | 否 | `database` |
| Editor Scan | 是 | 否 | — |
| Usage Monitor | 是 | 否 | — |
| Model Price | 是 | 否 | `model_price` |
| Connectors | 是 | 否 | — |

默认 Dock 从 app definition 的 `dock.pinnedByDefault` 与 `dock.order` 派生，顺序为：`agent`、`drive`、`automation`、`workflow`、`terminal`、`settings`、`launcher`。Workflow 由统一 System App `visibility` 与 `workflowEntryVisible` 控制。

Git 仍是普通 System App，不新增 MCP domain。其带恢复 journal 的原子 clone、仓库注册、状态与差异预览、主进程选择令牌、精确提交与按文件丢弃、同步、空仓库初始化与远端默认分支接入、缓存远程分支发现与 tracking 检出、SSH 主机密钥、操作状态与取消能力只通过窄类型化 Git IPC bridge 暴露；仓库目录定位复用受权限与审计保护的 Shell IPC，设为项目复用系统设置的全局项目配置与添加流程。Agent 项目与 Git 仓库根路径精确匹配时，composer 可复用同一 Git IPC 执行确认后的全部改动提交及常用远端操作，并可定向打开对应 Git 工作台；该入口不经过 Agent、MCP 或通用命令执行。这不改变上表的 capability 或 MCP 数量。远程分支、空仓库初始化与文件丢弃能力不注册任意 Git 命令入口，也不扩展为 Workflow、Automation、MCP 或 Deep Link 表面。

MCP 不是 System App，不进入启动器、Dock 或独立应用窗口。系统设置中的 MCP 分类是全局 MCP Server 与外部客户端注册信息的唯一 UI 入口；它聚合当前全部已注册 domain，但不新增 capability 或 MCP tool。Connectors 是独立的 System App；客户端内置定义通过 `integration.kind` 选择 Driver，状态写入版本化的 Synapse DataRepository，并在内置 Claude SDK 会话创建时临时注入 MCP 和对应 Skill，不写入外部 Claude 配置。V1 仅支持无认证的 `http://127.0.0.1:<port>/<path>` Streamable HTTP MCP；探测必须完成 MCP 初始化、initialized 通知、`tools/list` 和必需工具校验，失败或超时不得启用。当前 Figma 定义使用 `http://127.0.0.1:3845/mcp` 和内置 `figma-skill`，Skill 不声明 Figma 写入能力。新对话把已启用的连接器 ID 固化到会话快照，并从同一份 Agent Contribution 加载 MCP 与 Skill；已有对话不会因之后启停而动态变化，最终 Query 缺少预期 MCP 时不得启动半连接会话。

## MCP capability domain

| Domain | Capability 数 | MCP Tool 数 |
|---|---:|---:|
| `app` | 62 | 58 |
| `database` | 30 | 30 |
| `model_price` | 11 | 11 |
| `repository` | 1 | 1 |
| `skill_repository` | 9 | 9 |
| `automation` | 14 | 14 |
| `workflow` | 19 | 19 |
| `content` | 16 | 16 |
| `drive` | 63 | 63 |
| 合计 | 225 | 223 |

Agent 实验功能可在第三方 Anthropic-compatible 新对话中向 SDK 临时注入进程内 `synapse-tool-router`，其 `search`、`invoke` 仅用于按需发现和调用上表已有的 223 个工具。它们不通过 `/mcp`、Claude Code 注册、capability catalog 或 `tools/list` 公开，因此不计入 capability 或 MCP Tool 数量；公开工具名、schema、URL 和数量均不变。

`app` domain 中不映射 MCP tool 的四个 capability 固定为：

- `app.javascript.script.execute`
- `app.nodejs.script.execute`
- `app.clipboard.text.write`
- `app.clipboard.text.read`

Drive 的 `app.drive.share.create` 与 `app.drive.site.create` 在未传访问设置时均创建公开、永久的新分享；网页分享创建工具只要求来源文件夹与名称。该契约调整不改变 `drive` domain 的 capability 或 MCP tool 数量。

Drive 本地同步通过 9 个 `app.drive.sync.*` capability 暴露给 MCP：快照、预检、创建、暂停、恢复、停止、排除规则、完整扫描和冲突处理。它们复用桌面端 `core.drive-sync`，不新增独立同步引擎或 Web 端能力。

Drive 分享评论通过 6 个 `app.drive.link.annotation.*` capability 暴露给 MCP：线程列表、新建线程、回复、编辑评论、删除评论和删除线程。文字评论直接提交 quote；整图评论先通过 `app_drive_link_read_text` 取得 `imageId`，再创建线程。图片或文字目标失效后保留为未定位线程，不提供手动重关联。删除评论会连带删除其全部后代回复，删除首评会移除整条讨论。它们只接受当前 Synapse `/share/...` 下的 `.md` 文档，复用现有分享访问、评论权限和审计；不开放文档编辑、presence 或协同房间控制。

## 同步硬规则

- 新增、删除、重命名或改变任意 System App、默认 Dock、Workflow Node、Automation Action、MCP capability/tool、Deep Link 或 `desktop/app-capabilities/<id>` 能力包时，同一次改动必须更新本文件的表格、数量、例外和默认 Dock 顺序。
- 修改启动器可见性、Workflow 条件入口、`systemApp`、`discovery`、`openable`、`pinnableToDock`、`defaultDock` 或任何改变产品表面的过滤逻辑时，也必须同步。
- 即使改动不在 `desktop/app-capabilities/`，只要影响普通 System App 或 MCP domain，就必须更新本文件。
- 只修改能力内部实现且注册表面不变时可以不改数字，但必须主动核对本清单仍与运行时装配一致。
